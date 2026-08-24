use std::env;
use std::error::Error;
use std::io;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::time::timeout;

type AztecResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Entry {
    pub table_id: String,
    pub entry_id: String,
    pub seat: usize,
    pub account: String,
    pub amount: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Authorization {
    pub existing: bool,
    pub tx: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChainSettlement {
    Settled,
    Pending,
    Retry,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EntryState {
    pub paid: bool,
    pub authorized: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Settlement {
    pub table_id: String,
    pub recipients: [String; 6],
    pub payouts: [u64; 6],
}

#[derive(Clone)]
pub struct Aztec {
    node: PathBuf,
    helper: PathBuf,
    gate: Arc<Mutex<()>>,
}

#[derive(Serialize)]
#[serde(tag = "op", rename_all = "lowercase")]
enum Request {
    Check,
    Authorize {
        table_id: String,
        entry_id: String,
        seat: usize,
        account: String,
        amount: String,
    },
    Authorized {
        table_id: String,
        entry_id: String,
        seat: usize,
        account: String,
        amount: String,
    },
    Cancel {
        entry_id: String,
    },
    Entry {
        table_id: String,
        entry_id: String,
        seat: usize,
        account: String,
        amount: String,
    },
    Settle {
        table_id: String,
        recipients: Box<[String; 6]>,
        payouts: Box<[String; 6]>,
    },
    Settlement {
        table_id: String,
        recipients: Box<[String; 6]>,
        payouts: Box<[String; 6]>,
        tx_hash: Option<String>,
    },
}

#[derive(Deserialize)]
struct CheckResult {
    owner: String,
}

#[derive(Deserialize)]
struct TxResult {
    tx: String,
}

#[derive(Deserialize)]
struct AuthorizationResult {
    existing: bool,
    tx: Option<String>,
}

#[derive(Deserialize)]
struct AuthorizedResult {
    authorized: bool,
}

#[derive(Deserialize)]
struct EntryResult {
    exists: bool,
    authorized: bool,
    table_id: String,
    account: String,
    seat: usize,
    amount: String,
}

#[derive(Deserialize)]
struct SettlementResult {
    settled: bool,
    commitment: String,
    retry: bool,
}

impl Aztec {
    pub fn from_env() -> AztecResult<Self> {
        let helper = env::var_os("AZTEC_SERVER_HELPER")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../aztec/scripts/server.mjs")
            });

        if !helper.is_file() {
            return Err(io::Error::other("aztec server helper missing").into());
        }

        Ok(Self {
            node: env::var_os("AZTEC_SERVER_NODE")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("node")),
            helper,
            gate: Arc::new(Mutex::new(())),
        })
    }

    pub async fn check(&self) -> AztecResult<String> {
        let result: CheckResult = self.call(Request::Check).await?;
        Ok(result.owner)
    }

    pub async fn authorize(&self, entry: &Entry) -> AztecResult<Authorization> {
        let result: AuthorizationResult = self.call(entry_request(entry, true)).await?;
        match (result.existing, result.tx) {
            (true, None) => Ok(Authorization {
                existing: true,
                tx: None,
            }),
            (false, Some(tx)) => Ok(Authorization {
                existing: false,
                tx: Some(tx),
            }),
            _ => Err(io::Error::other("invalid aztec authorization response").into()),
        }
    }

    pub async fn authorized(&self, entry: &Entry) -> AztecResult<bool> {
        let result: AuthorizedResult = self.call(authorized_request(entry)).await?;
        Ok(result.authorized)
    }

    pub async fn confirms(&self, entry: &Entry) -> AztecResult<bool> {
        Ok(self.entry_state(entry).await?.paid)
    }

    pub async fn entry_state(&self, entry: &Entry) -> AztecResult<EntryState> {
        let result: EntryResult = self.call(entry_request(entry, false)).await?;
        Ok(EntryState {
            paid: result.matches(entry),
            authorized: result.authorized,
        })
    }

    pub async fn cancel(&self, entry: &Entry) -> AztecResult<String> {
        let result: TxResult = self
            .call(Request::Cancel {
                entry_id: entry.entry_id.clone(),
            })
            .await?;
        Ok(result.tx)
    }

    pub async fn settle(&self, settlement: &Settlement) -> AztecResult<String> {
        let payouts = settlement.payouts.map(|value| value.to_string());
        let result: TxResult = self
            .call(Request::Settle {
                table_id: settlement.table_id.clone(),
                recipients: Box::new(settlement.recipients.clone()),
                payouts: Box::new(payouts),
            })
            .await?;
        Ok(result.tx)
    }

    pub async fn settled(
        &self,
        settlement: &Settlement,
        tx_hash: Option<&str>,
    ) -> AztecResult<ChainSettlement> {
        let payouts = settlement.payouts.map(|value| value.to_string());
        let result: SettlementResult = self
            .call(Request::Settlement {
                table_id: settlement.table_id.clone(),
                recipients: Box::new(settlement.recipients.clone()),
                payouts: Box::new(payouts),
                tx_hash: tx_hash.map(str::to_owned),
            })
            .await?;
        if result.settled && !valid_field(&result.commitment) {
            return Err(io::Error::other("invalid aztec settlement response").into());
        }
        Ok(if result.settled {
            ChainSettlement::Settled
        } else if result.retry {
            ChainSettlement::Retry
        } else {
            ChainSettlement::Pending
        })
    }

    async fn call<T>(&self, request: Request) -> AztecResult<T>
    where
        T: DeserializeOwned + Send + 'static,
    {
        let input = serde_json::to_vec(&request)?;
        let _guard = self.gate.lock().await;
        let mut child = Command::new(&self.node);
        child
            .arg(&self.helper)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = child.spawn()?;
        child
            .stdin
            .take()
            .ok_or_else(|| io::Error::other("aztec helper input missing"))?
            .write_all(&input)
            .await?;

        let output = timeout(Duration::from_secs(45), child.wait_with_output())
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "aztec helper timed out"))??;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(io::Error::other(error.trim().to_owned()).into());
        }

        let stdout = String::from_utf8(output.stdout)?;
        stdout
            .lines()
            .rev()
            .find_map(|line| serde_json::from_str(line).ok())
            .ok_or_else(|| io::Error::other("invalid aztec helper response").into())
    }
}

impl EntryResult {
    fn matches(&self, expected: &Entry) -> bool {
        self.exists
            && same_hex(&self.table_id, &expected.table_id)
            && self.account.eq_ignore_ascii_case(&expected.account)
            && self.seat == expected.seat
            && self.amount.parse::<u64>() == Ok(expected.amount)
    }
}

fn entry_request(entry: &Entry, authorize: bool) -> Request {
    let fields = (
        entry.table_id.clone(),
        entry.entry_id.clone(),
        entry.seat,
        entry.account.clone(),
        entry.amount.to_string(),
    );

    if authorize {
        Request::Authorize {
            table_id: fields.0,
            entry_id: fields.1,
            seat: fields.2,
            account: fields.3,
            amount: fields.4,
        }
    } else {
        Request::Entry {
            table_id: fields.0,
            entry_id: fields.1,
            seat: fields.2,
            account: fields.3,
            amount: fields.4,
        }
    }
}

fn authorized_request(entry: &Entry) -> Request {
    Request::Authorized {
        table_id: entry.table_id.clone(),
        entry_id: entry.entry_id.clone(),
        seat: entry.seat,
        account: entry.account.clone(),
        amount: entry.amount.to_string(),
    }
}

fn same_hex(left: &str, right: &str) -> bool {
    fn digits(value: &str) -> Option<&str> {
        let value = value.strip_prefix("0x")?;
        if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        Some(value.trim_start_matches('0'))
    }

    match (digits(left), digits(right)) {
        (Some(left), Some(right)) => left.eq_ignore_ascii_case(right),
        _ => false,
    }
}

fn valid_field(value: &str) -> bool {
    value.len() == 66
        && value.starts_with("0x")
        && value[2..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expected() -> Entry {
        Entry {
            table_id: "0x000001".to_owned(),
            entry_id: "0x02".to_owned(),
            seat: 2,
            account: format!("0x{}", "ab".repeat(32)),
            amount: 1_000,
        }
    }

    #[test]
    fn entry_match() {
        let entry = expected();
        let result = EntryResult {
            exists: true,
            authorized: false,
            table_id: "0x1".to_owned(),
            account: format!("0x{}", "AB".repeat(32)),
            seat: 2,
            amount: "1000".to_owned(),
        };

        assert!(result.matches(&entry));
    }

    #[test]
    fn entry_mismatch() {
        let entry = expected();
        let mut result = EntryResult {
            exists: true,
            authorized: false,
            table_id: "0x1".to_owned(),
            account: entry.account.clone(),
            seat: 2,
            amount: "999".to_owned(),
        };

        assert!(!result.matches(&entry));
        result.amount = "1000".to_owned();
        result.exists = false;
        assert!(!result.matches(&entry));
    }

    #[test]
    fn hex_match() {
        assert!(same_hex("0x0000aB", "0xAB"));
        assert!(same_hex("0x0", "0x000"));
        assert!(!same_hex("ab", "0xab"));
        assert!(!same_hex("0xzz", "0x00"));
    }
}
