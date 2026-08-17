use std::error::Error;
use std::fs;
use std::io;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};

use barretenberg_rs::BarretenbergApi;
use barretenberg_rs::backends::PipeBackend;
use barretenberg_rs::generated_types::ProofSystemSettings;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use sha2::{Digest, Sha256};

const FIELD_BYTES: usize = 32;
// circuit public u8s use one field each
const PUBLIC_FIELDS: usize = 194;
const PUBLIC_BYTES: usize = PUBLIC_FIELDS * FIELD_BYTES;
const MAX_PROOF_BYTES: usize = 65_536;
const BB_VERSION: &str = "5.2.0";
const VK_DIGEST: [u8; 32] = [
    0x5a, 0x70, 0xd3, 0xd6, 0xe8, 0x04, 0xc8, 0x94, 0xee, 0x33, 0x4e, 0xf0, 0xcb, 0x32, 0x4c, 0x5d,
    0x06, 0x2a, 0x11, 0x6c, 0xa7, 0x3b, 0xb5, 0x64, 0xfb, 0x04, 0x0a, 0xcc, 0x30, 0xfb, 0xfa, 0xa0,
];

type ProofResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

#[derive(Clone)]
pub struct ProofVerifier {
    api: Arc<Mutex<BarretenbergApi<PipeBackend>>>,
    vk: Arc<Vec<u8>>,
}

pub struct ClaimProof {
    pub proof: Vec<Vec<u8>>,
    pub public_inputs: Vec<Vec<u8>>,
    pub inputs: ClaimInputs,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ClaimInputs {
    pub hand_tag: [u8; 32],
    pub seat: u8,
    pub tier: u8,
    pub commitment: [u8; 32],
    pub nonce: [u8; 32],
    pub facts_hash: [u8; 32],
    pub nullifier: [u8; 32],
    pub catalog_root: [u8; 32],
}

impl ProofVerifier {
    pub fn load(bb: impl AsRef<Path>, vk: impl AsRef<Path>) -> ProofResult<Self> {
        let version = Command::new(bb.as_ref()).arg("--version").output()?;

        if !version.status.success() || String::from_utf8(version.stdout)?.trim() != BB_VERSION {
            return Err(io::Error::other("bb version mismatch").into());
        }

        let vk = fs::read(vk)?;
        let digest: [u8; 32] = Sha256::digest(&vk).into();

        if digest != VK_DIGEST {
            return Err(io::Error::other("challenge verification key mismatch").into());
        }

        let backend = PipeBackend::new(bb, None)?;

        Ok(Self {
            api: Arc::new(Mutex::new(BarretenbergApi::new(backend))),
            vk: Arc::new(vk),
        })
    }

    pub async fn verify(&self, proof: ClaimProof) -> ProofResult<bool> {
        let api = Arc::clone(&self.api);
        let vk = Arc::clone(&self.vk);

        // pipe proof work off async runtime
        tokio::task::spawn_blocking(move || {
            let mut api = api
                .lock()
                .map_err(|_| io::Error::other("proof verifier stopped"))?;
            let result = api.circuit_verify(
                &vk,
                proof.public_inputs,
                proof.proof,
                ProofSystemSettings {
                    ipa_accumulation: false,
                    oracle_hash_type: "poseidon2".to_owned(),
                    disable_zk: false,
                    optimized_solidity_verifier: false,
                },
            )?;

            Ok(result.verified)
        })
        .await?
    }
}

pub fn decode_claim(proof: &str, public_inputs: &str) -> Result<ClaimProof, &'static str> {
    if proof.is_empty()
        || proof.len() > MAX_PROOF_BYTES.div_ceil(3) * 4
        || public_inputs.len() != PUBLIC_BYTES.div_ceil(3) * 4
    {
        return Err("invalid challenge proof");
    }

    let proof = STANDARD
        .decode(proof)
        .map_err(|_| "invalid challenge proof")?;
    let public = STANDARD
        .decode(public_inputs)
        .map_err(|_| "invalid challenge proof")?;

    if proof.is_empty()
        || proof.len() > MAX_PROOF_BYTES
        || !proof.len().is_multiple_of(FIELD_BYTES)
        || public.len() != PUBLIC_BYTES
    {
        return Err("invalid challenge proof");
    }

    let public_inputs = fields(public);
    let inputs = ClaimInputs::decode(&public_inputs)?;

    Ok(ClaimProof {
        proof: fields(proof),
        public_inputs,
        inputs,
    })
}

impl ClaimInputs {
    fn decode(fields: &[Vec<u8>]) -> Result<Self, &'static str> {
        if fields.len() != PUBLIC_FIELDS {
            return Err("invalid challenge proof");
        }

        let mut offset = 0;
        let hand_tag = take_bytes(fields, &mut offset)?;
        let seat = take_byte(fields, &mut offset)?;
        let tier = take_byte(fields, &mut offset)?;
        let commitment = take_bytes(fields, &mut offset)?;
        let nonce = take_bytes(fields, &mut offset)?;
        let facts_hash = take_bytes(fields, &mut offset)?;
        let nullifier = take_bytes(fields, &mut offset)?;
        let catalog_root = take_bytes(fields, &mut offset)?;

        Ok(Self {
            hand_tag,
            seat,
            tier,
            commitment,
            nonce,
            facts_hash,
            nullifier,
            catalog_root,
        })
    }
}

fn fields(bytes: Vec<u8>) -> Vec<Vec<u8>> {
    bytes
        .chunks_exact(FIELD_BYTES)
        .map(<[u8]>::to_vec)
        .collect()
}

fn take_bytes(fields: &[Vec<u8>], offset: &mut usize) -> Result<[u8; 32], &'static str> {
    let mut bytes = [0u8; 32];

    for byte in &mut bytes {
        *byte = take_byte(fields, offset)?;
    }

    Ok(bytes)
}

fn take_byte(fields: &[Vec<u8>], offset: &mut usize) -> Result<u8, &'static str> {
    let field = fields.get(*offset).ok_or("invalid challenge proof")?;
    *offset += 1;

    if field.len() != FIELD_BYTES || field[..FIELD_BYTES - 1].iter().any(|&byte| byte != 0) {
        return Err("invalid challenge proof");
    }

    Ok(field[FIELD_BYTES - 1])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_order() {
        let mut values = Vec::new();

        for byte in [
            &[1; 32][..],
            &[2][..],
            &[3][..],
            &[4; 32][..],
            &[5; 32][..],
            &[6; 32][..],
            &[7; 32][..],
            &[8; 32][..],
        ] {
            for &byte in byte {
                let mut field = vec![0; 32];
                field[31] = byte;
                values.push(field);
            }
        }

        assert_eq!(
            ClaimInputs::decode(&values).unwrap(),
            ClaimInputs {
                hand_tag: [1; 32],
                seat: 2,
                tier: 3,
                commitment: [4; 32],
                nonce: [5; 32],
                facts_hash: [6; 32],
                nullifier: [7; 32],
                catalog_root: [8; 32],
            }
        );
    }

    #[test]
    fn noncanonical_input() {
        let mut fields = vec![vec![0; 32]; PUBLIC_FIELDS];

        fields[0][0] = 1;

        assert_eq!(ClaimInputs::decode(&fields), Err("invalid challenge proof"));
    }

    #[test]
    fn malformed_payload() {
        assert!(decode_claim("", "").is_err());
        assert!(decode_claim("%%%%", "x").is_err());
        assert!(
            decode_claim(
                &STANDARD.encode([0; 31]),
                &STANDARD.encode([0; PUBLIC_BYTES])
            )
            .is_err()
        );
    }

    #[tokio::test]
    #[ignore = "requires BB_PATH and built ZK artifacts"]
    async fn real_proof() {
        let output = Command::new("node")
            .arg(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../web/scripts/prove-fixture.mjs"
            ))
            .output()
            .unwrap();

        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );

        let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        let proof = value["proof"].as_str().unwrap();
        let public = value["public_inputs"].as_str().unwrap();
        let bb = std::env::var("BB_PATH").unwrap();
        let vk = std::env::var("CHALLENGE_VK_PATH").unwrap_or_else(|_| {
            concat!(env!("CARGO_MANIFEST_DIR"), "/zk/challenge_v1.vk").to_owned()
        });
        let bad = std::env::temp_dir().join(format!("noir-poker-wrong-vk-{}", std::process::id()));
        let mut bytes = fs::read(&vk).unwrap();

        bytes[0] ^= 1;
        fs::write(&bad, bytes).unwrap();
        assert!(ProofVerifier::load(&bb, &bad).is_err());
        fs::remove_file(bad).unwrap();
        assert!(ProofVerifier::load(&bb, "/missing/noir-poker-vk").is_err());

        let verifier = ProofVerifier::load(bb, vk).unwrap();
        let started = std::time::Instant::now();

        assert!(
            verifier
                .verify(decode_claim(proof, public).unwrap())
                .await
                .unwrap()
        );
        eprintln!(
            "server verification {:.3}s",
            started.elapsed().as_secs_f64()
        );

        let mut altered = decode_claim(proof, public).unwrap();
        altered.proof[0][0] ^= 1;

        assert!(!verifier.verify(altered).await.unwrap());
    }
}
