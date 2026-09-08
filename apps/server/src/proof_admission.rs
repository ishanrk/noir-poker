use std::io;
use std::sync::{Arc, OnceLock};
use std::time::Instant;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

struct Limits {
    admitted: Arc<Semaphore>,
    running: Arc<Semaphore>,
}
static LIMITS: OnceLock<Limits> = OnceLock::new();
pub struct Admission {
    _queued: OwnedSemaphorePermit,
    _running: OwnedSemaphorePermit,
}
pub async fn admit() -> Result<Admission, io::Error> {
    LIMITS.get_or_init(Limits::new).admit().await
}
impl Limits {
    fn new() -> Self {
        Self {
            admitted: Arc::new(Semaphore::new(8)),
            running: Arc::new(Semaphore::new(1)),
        }
    }
    async fn admit(&self) -> Result<Admission, io::Error> {
        let limits = self;
        let at = Instant::now();
        let queued = limits
            .admitted
            .clone()
            .try_acquire_owned()
            .map_err(|_| io::Error::other("proof capacity busy"))?;
        let running = limits
            .running
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| io::Error::other("proof scheduler stopped"))?;
        record("queue", at);
        Ok(Admission {
            _queued: queued,
            _running: running,
        })
    }
}
pub fn record(stage: &str, at: Instant) {
    if std::env::var("NOIR_DIAGNOSTICS").as_deref() == Ok("1") {
        eprintln!(
            "proof_timing stage={stage} elapsed_ms={}",
            at.elapsed().as_millis()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn bounded_queue_and_cancelled_blocking_owner() {
        let limits = Arc::new(Limits::new());
        let permit = limits.admit().await.unwrap();
        let (release, wait) = std::sync::mpsc::channel();
        let (started, ready) = tokio::sync::oneshot::channel();
        let owner = tokio::spawn(async move {
            tokio::task::spawn_blocking(move || {
                let _permit = permit;
                let _ = started.send(());
                wait.recv().unwrap();
            })
            .await
            .unwrap();
        });
        ready.await.unwrap();
        owner.abort();
        assert_eq!(limits.running.available_permits(), 0);
        let mut queued = Vec::new();
        for _ in 0..7 {
            let limits = Arc::clone(&limits);
            queued.push(tokio::spawn(async move { limits.admit().await }));
        }
        tokio::task::yield_now().await;
        assert!(limits.admit().await.is_err());
        for job in queued {
            job.abort();
            let _ = job.await;
        }
        assert_eq!(limits.admitted.available_permits(), 7);
        release.send(()).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while limits.running.available_permits() != 1 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(limits.admitted.available_permits(), 8);
    }
}
