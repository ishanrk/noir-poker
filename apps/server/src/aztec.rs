use std::env;
use std::error::Error;
use std::io;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

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
    Entry {
        table_id: String,
        entry_id: String,
        seat: usize,
        account: String,
        amount: String,
    },
    Settle {
        table_id: String,
        recipients: [String; 6],
        payouts: [String; 6],
    },
    Settlement {
        table_id: String,
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
struct EntryResult {
    exists: bool,
    table_id: String,
    account: String,
    seat: usize,
    amount: String,
}

#[derive(Deserialize)]
struct SettlementResult {
    settled: bool,
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

    pub async fn confirms(&self, entry: &Entry) -> AztecResult<bool> {
        let result: EntryResult = self.call(entry_request(entry, false)).await?;
        Ok(result.matches(entry))
    }

    pub async fn settle(&self, settlement: &Settlement) -> AztecResult<String> {
        let payouts = settlement.payouts.map(|value| value.to_string());
        let result: TxResult = self
            .call(Request::Settle {
                table_id: settlement.table_id.clone(),
                recipients: settlement.recipients.clone(),
                payouts,
            })
            .await?;
        Ok(result.tx)
    }

    pub async fn settled(&self, table_id: &str) -> AztecResult<bool> {
        let result: SettlementResult = self
            .call(Request::Settlement {
                table_id: table_id.to_owned(),
            })
            .await?;
        Ok(result.settled)
    }

    async fn call<T>(&self, request: Request) -> AztecResult<T>
    where
        T: DeserializeOwned + Send + 'static,
    {
        let input = serde_json::to_vec(&request)?;
        let node = self.node.clone();
        let helper = self.helper.clone();
        let gate = Arc::clone(&self.gate);

        tokio::task::spawn_blocking(move || {
            let _guard = gate
                .lock()
                .map_err(|_| io::Error::other("aztec helper stopped"))?;
            let mut child = Command::new(node)
                .arg(helper)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()?;

            child
                .stdin
                .take()
                .ok_or_else(|| io::Error::other("aztec helper input missing"))?
                .write_all(&input)?;

            let output = child.wait_with_output()?;
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
        })
        .await?
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
