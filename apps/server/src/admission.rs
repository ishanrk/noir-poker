use std::collections::VecDeque;
use std::env;
use std::io;
use std::time::{Duration, Instant};

pub(super) struct Admission {
    pub(super) max_rooms: usize,
    pub(super) experimental_aztec: bool,
    per_minute: usize,
    recent: VecDeque<Instant>,
}

impl Default for Admission {
    fn default() -> Self {
        Self {
            max_rooms: 100,
            experimental_aztec: false,
            per_minute: 10,
            recent: VecDeque::new(),
        }
    }
}

impl Admission {
    pub(super) fn load() -> Result<Self, io::Error> {
        let mut policy = Self::default();
        for (key, field) in [
            ("MAX_ROOMS", &mut policy.max_rooms),
            ("ROOMS_PER_MINUTE", &mut policy.per_minute),
        ] {
            if let Ok(value) = env::var(key) {
                *field = value
                    .parse()
                    .map_err(|_| io::Error::other("invalid room admission limit"))?;
                if *field == 0 {
                    return Err(io::Error::other("room admission limit must be positive"));
                }
            }
        }
        policy.experimental_aztec =
            env::var("ENABLE_EXPERIMENTAL_AZTEC").is_ok_and(|value| value == "true");
        Ok(policy)
    }

    pub(super) fn accept(&mut self, rooms: usize, now: Instant) -> Result<(), &'static str> {
        if rooms >= self.max_rooms {
            return Err("room capacity reached");
        }
        while self
            .recent
            .front()
            .is_some_and(|time| now.duration_since(*time) >= Duration::from_secs(60))
        {
            self.recent.pop_front();
        }
        if self.recent.len() >= self.per_minute {
            return Err("room creation rate exceeded");
        }
        self.recent.push_back(now);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_rooms_and_rate() {
        let mut policy = Admission {
            max_rooms: 2,
            per_minute: 1,
            ..Admission::default()
        };
        let now = Instant::now();
        assert!(policy.accept(0, now).is_ok());
        assert_eq!(policy.accept(1, now), Err("room creation rate exceeded"));
        assert_eq!(
            policy.accept(2, now + Duration::from_secs(60)),
            Err("room capacity reached")
        );
        assert!(policy.accept(1, now + Duration::from_secs(60)).is_ok());
    }
}
