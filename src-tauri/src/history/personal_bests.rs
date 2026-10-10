//! TooWholeDPS: the local player's best DPS against each boss.
//!
//! One record per boss, instance tier and class (`mob_code:dungeon_id:job`),
//! kept in its own `personal_bests.json` so the History cap of 500 fights can
//! never prune a best away. Training dummies, trash (no mob code) and fights
//! shorter than `MIN_DURATION_MS` don't count: a ten-second opener on a boss
//! is not a clear.
//!
//! A boss fight is saved every 30 seconds while it lasts, each time under the
//! same fight id. An early save can run above the PB on the opening burst and
//! then fall below it as the fight goes on, so a record that replaced an older
//! best keeps that best as `prior`: if a later save of the same fight drops
//! back under it, the older best comes back.

use std::collections::BTreeMap;
use std::path::PathBuf;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::entity::fight_record::FightRecord;

/// Shorter fights never set a personal best.
pub const MIN_DURATION_MS: i64 = 20_000;
/// A fight counts only as a kill: the damage tracked on the boss reached at
/// least this share of its max HP (when its max HP is known). Below 1 because
/// a hit or two can go unseen.
pub const KILL_SHARE: f64 = 0.85;
/// No damage for this long and the fight is over (the meter's own rule for
/// an ended boss fight, `DpsCalculator::snapshot_boss_fights`).
pub const SETTLED_AFTER_MS: i64 = 10_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalBest {
    pub mob_code: i32,
    pub dungeon_id: i32,
    /// Class name as the meter's rows carry it (`job` on a row).
    pub job: String,
    pub job_id: i32,
    pub boss_name: String,
    pub character: String,
    pub dps: i64,
    pub damage: i64,
    pub duration_ms: i64,
    pub fight_id: String,
    pub achieved_at_ms: i64,
    /// The best this one replaced, while this fight may still be re-saved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prior: Option<Box<PersonalBest>>,
}

impl PersonalBest {
    pub fn key(&self) -> String {
        format!("{}:{}:{}", self.mob_code, self.dungeon_id, self.job)
    }
}

/// What saving one fight did to the bests.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PbOutcome {
    pub best: PersonalBest,
    /// The DPS it beat; `None` for the first clear of this boss.
    pub previous_dps: Option<i64>,
}

/// The local player's own numbers in `record`, as a best-to-be. `None` when
/// the fight cannot count or the player is not in it.
pub fn evaluate(record: &FightRecord, local_name: Option<&str>, local_id: Option<i32>) -> Option<PersonalBest> {
    if record.is_train || record.mob_code == 0 || record.duration_ms < MIN_DURATION_MS {
        return None;
    }
    let max_hp = record.details.max_hp as f64;
    if max_hp > 0.0 && (record.details.total_target_damage as f64) < max_hp * KILL_SHARE {
        return None; // a wipe or a reset, not a kill
    }
    let name = local_name.map(str::trim).filter(|n| !n.is_empty());
    // Every name but the local player's is masked when a fight is recorded,
    // so a name match can only be the local player.
    let me = record
        .actors
        .iter()
        .find(|a| local_id.is_some_and(|id| id == a.actor_id))
        .or_else(|| name.and_then(|n| record.actors.iter().find(|a| a.nickname.trim() == n)))?;
    let damage: i64 = record
        .details
        .skills
        .iter()
        .filter(|s| s.actor_id == me.actor_id)
        .map(|s| s.dmg.max(0) as i64)
        .sum();
    if damage <= 0 {
        return None;
    }
    let dps = damage * 1000 / record.duration_ms;
    let job = if me.job.is_empty() {
        record
            .details
            .skills
            .iter()
            .find(|s| s.actor_id == me.actor_id && !s.job.is_empty())
            .map(|s| s.job.clone())
            .unwrap_or_default()
    } else {
        me.job.clone()
    };
    Some(PersonalBest {
        mob_code: record.mob_code,
        dungeon_id: record.dungeon_id,
        job,
        job_id: me.job_id,
        boss_name: record.boss_name.clone(),
        character: me.nickname.clone(),
        dps,
        damage,
        duration_ms: record.duration_ms,
        fight_id: record.id.clone(),
        achieved_at_ms: record.start_time_ms + record.duration_ms,
        prior: None,
    })
}

/// Fold `candidate` into `bests`. Returns the outcome when this is a new best
/// (the first time a fight beats the standing one, not each re-save of it).
pub fn apply(bests: &mut BTreeMap<String, PersonalBest>, candidate: PersonalBest) -> Option<PbOutcome> {
    let key = candidate.key();
    match bests.get(&key).cloned() {
        None => {
            bests.insert(key, candidate.clone());
            Some(PbOutcome { best: candidate, previous_dps: None })
        }
        // A later save of the fight that holds the best.
        Some(current) if current.fight_id == candidate.fight_id => {
            match current.prior {
                Some(prior) if candidate.dps < prior.dps => {
                    bests.insert(key, *prior);
                }
                prior => {
                    bests.insert(key, PersonalBest { prior, ..candidate });
                }
            }
            None
        }
        Some(current) if candidate.dps > current.dps => {
            let previous_dps = Some(current.dps);
            let mut prior = current;
            prior.prior = None;
            let best = PersonalBest { prior: Some(Box::new(prior)), ..candidate };
            bests.insert(key, best.clone());
            Some(PbOutcome { best: PersonalBest { prior: None, ..best }, previous_dps })
        }
        Some(_) => None,
    }
}

pub struct PersonalBestStore {
    path: PathBuf,
    bests: Mutex<BTreeMap<String, PersonalBest>>,
    /// Fights that set a best while still going: fight id -> the DPS they
    /// beat. Announced once the fight is over and still holds the best.
    pending: Mutex<BTreeMap<String, Option<i64>>>,
}

impl PersonalBestStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let path = app_data_dir.join("personal_bests.json");
        let bests = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Vec<PersonalBest>>(&text).ok())
            .map(|list| list.into_iter().map(|b| (b.key(), b)).collect())
            .unwrap_or_default();
        Self { path, bests: Mutex::new(bests), pending: Mutex::new(BTreeMap::new()) }
    }

    pub fn list(&self) -> Vec<PersonalBest> {
        let mut list: Vec<PersonalBest> = self
            .bests
            .lock()
            .values()
            .cloned()
            .map(|b| PersonalBest { prior: None, ..b })
            .collect();
        list.sort_by(|a, b| b.achieved_at_ms.cmp(&a.achieved_at_ms));
        list
    }

    pub fn is_empty(&self) -> bool {
        self.bests.lock().is_empty()
    }

    /// Consider a saved fight. `settled`: the fight is over, so this is its
    /// last save. Returns the new best to announce, only once it is settled.
    pub fn consider(
        &self,
        record: &FightRecord,
        local_name: Option<&str>,
        local_id: Option<i32>,
        settled: bool,
    ) -> Option<PbOutcome> {
        let candidate = evaluate(record, local_name, local_id)?;
        let key = candidate.key();
        let mut bests = self.bests.lock();
        let before = bests.clone();
        let outcome = apply(&mut bests, candidate);
        if *bests != before {
            self.write(&bests);
        }
        let mut pending = self.pending.lock();
        if let Some(outcome) = &outcome {
            pending.insert(record.id.clone(), outcome.previous_dps);
        }
        if !settled {
            return None;
        }
        let previous_dps = pending.remove(&record.id)?;
        // Still the best after its last save (it may have faded below the old one).
        let best = bests.get(&key).filter(|b| b.fight_id == record.id)?;
        Some(PbOutcome { best: PersonalBest { prior: None, ..best.clone() }, previous_dps })
    }

    /// Fold many fights in at once (History backfill), writing once.
    pub fn backfill<'a>(&self, records: impl IntoIterator<Item = &'a FightRecord>, local_name: &str) -> usize {
        let mut bests = self.bests.lock();
        let before = bests.clone();
        for record in records {
            if let Some(candidate) = evaluate(record, Some(local_name), None) {
                apply(&mut bests, candidate);
            }
        }
        // Backfilled fights are finished: none will be re-saved.
        for best in bests.values_mut() {
            best.prior = None;
        }
        if *bests != before {
            self.write(&bests);
        }
        bests.len()
    }

    pub fn clear(&self) {
        let mut bests = self.bests.lock();
        bests.clear();
        self.write(&bests);
    }

    fn write(&self, bests: &BTreeMap<String, PersonalBest>) {
        let list: Vec<&PersonalBest> = bests.values().collect();
        match serde_json::to_string_pretty(&list) {
            Ok(json) => {
                if let Err(e) = crate::atomic_file::write(&self.path, json.as_bytes()) {
                    tracing::warn!("Could not save personal bests: {e}");
                }
            }
            Err(e) => tracing::warn!("Could not serialize personal bests: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: &str, mob: i32, dur: i64, dmg: i32, is_train: bool) -> FightRecord {
        serde_json::from_value(serde_json::json!({
            "id": id, "bossName": "Boss", "targetId": 9, "startTimeMs": 1_000, "durationMs": dur,
            "totalDamage": dmg, "jobs": [], "jobIds": [],
            "details": {"targetId": 9, "maxHp": 0, "totalTargetDamage": dmg, "battleTime": dur,
                "startTime": 0, "pingHistory": [], "healSkills": [], "skills": [
                    {"actorId": 7, "code": 1, "name": "a", "time": 1, "dmg": dmg, "multiHitCount": 0,
                     "multiHitDamage": 0, "crit": 0, "parry": 0, "back": 0, "perfect": 0, "double": 0,
                     "regen": 0, "job": "Cleric"},
                    {"actorId": 8, "code": 1, "name": "a", "time": 1, "dmg": 999_999, "multiHitCount": 0,
                     "multiHitDamage": 0, "crit": 0, "parry": 0, "back": 0, "perfect": 0, "double": 0,
                     "regen": 0, "job": "Ranger"}
                ]},
            "actors": [
                {"actorId": 7, "nickname": "TooWhole", "job": "Cleric", "jobId": 17},
                {"actorId": 8, "nickname": "Ot**r", "job": "Ranger", "jobId": 14}
            ],
            "isTrain": is_train, "appVersion": "1.0.0", "mobCode": mob, "dungeonId": 600092, "serverId": 0
        }))
        .unwrap()
    }

    fn eval(r: &FightRecord) -> PersonalBest {
        evaluate(r, Some("TooWhole"), None).unwrap()
    }

    #[test]
    fn takes_only_the_local_players_damage() {
        let best = eval(&record("a", 100, 60_000, 600_000, false));
        assert_eq!((best.dps, best.damage, best.job.as_str()), (10_000, 600_000, "Cleric"));
        assert_eq!(best.key(), "100:600092:Cleric");
    }

    #[test]
    fn matches_by_actor_id_too() {
        let r = record("a", 100, 60_000, 600_000, false);
        assert_eq!(evaluate(&r, None, Some(7)).unwrap().dps, 10_000);
        assert!(evaluate(&r, Some("Stranger"), None).is_none());
    }

    #[test]
    fn dummies_trash_and_short_fights_never_count() {
        assert!(evaluate(&record("a", 100, 60_000, 1, true), Some("TooWhole"), None).is_none());
        assert!(evaluate(&record("a", 0, 60_000, 1, false), Some("TooWhole"), None).is_none());
        assert!(evaluate(&record("a", 100, 5_000, 1, false), Some("TooWhole"), None).is_none());
    }

    #[test]
    fn first_clear_then_only_a_higher_dps_replaces_it() {
        let mut bests = BTreeMap::new();
        let first = apply(&mut bests, eval(&record("a", 100, 60_000, 600_000, false))).unwrap();
        assert_eq!(first.previous_dps, None);
        assert!(apply(&mut bests, eval(&record("b", 100, 60_000, 300_000, false))).is_none());
        let better = apply(&mut bests, eval(&record("c", 100, 60_000, 1_200_000, false))).unwrap();
        assert_eq!((better.previous_dps, better.best.dps), (Some(10_000), 20_000));
        assert_eq!(bests.values().next().unwrap().fight_id, "c");
    }

    #[test]
    fn a_fight_that_fades_below_the_old_best_gives_it_back() {
        let mut bests = BTreeMap::new();
        apply(&mut bests, eval(&record("old", 100, 60_000, 600_000, false)));
        // Opening burst of a new fight beats the best...
        assert!(apply(&mut bests, eval(&record("new", 100, 20_000, 400_000, false))).is_some());
        // ...a later save of it still beats it: no second "new best"...
        assert!(apply(&mut bests, eval(&record("new", 100, 30_000, 450_000, false))).is_none());
        assert_eq!(bests.values().next().unwrap().dps, 15_000);
        // ...and the final save falls below it: the old best is back.
        apply(&mut bests, eval(&record("new", 100, 120_000, 900_000, false)));
        let best = bests.values().next().unwrap();
        assert_eq!((best.fight_id.as_str(), best.dps), ("old", 10_000));
    }

    #[test]
    fn a_wipe_is_not_a_kill() {
        let mut r = record("a", 100, 60_000, 600_000, false);
        r.details.max_hp = 1_000_000;
        assert!(evaluate(&r, Some("TooWhole"), None).is_none());
        r.details.max_hp = 650_000;
        assert!(evaluate(&r, Some("TooWhole"), None).is_some());
    }

    #[test]
    fn a_new_best_is_announced_once_when_the_fight_ends() {
        let dir = std::env::temp_dir().join(format!("toowhole-pb-announce-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = PersonalBestStore::new(dir.clone());
        let me = Some("TooWhole");
        store.consider(&record("old", 100, 60_000, 600_000, false), me, None, true);
        // Mid-fight saves above the best: recorded, not announced.
        assert!(store.consider(&record("new", 100, 20_000, 400_000, false), me, None, false).is_none());
        assert!(store.consider(&record("new", 100, 30_000, 450_000, false), me, None, false).is_none());
        // The last save, still above: announced once, against the old best.
        let shown = store.consider(&record("new", 100, 40_000, 560_000, false), me, None, true).unwrap();
        assert_eq!((shown.best.dps, shown.previous_dps), (14_000, Some(10_000)));
        assert!(store.consider(&record("new", 100, 40_000, 560_000, false), me, None, true).is_none());
        // A fight that fades back below by its last save is never announced.
        store.consider(&record("fade", 100, 20_000, 600_000, false), me, None, false);
        assert!(store.consider(&record("fade", 100, 120_000, 600_000, false), me, None, true).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn store_round_trips_through_disk_and_backfills() {
        let dir = std::env::temp_dir().join(format!("toowhole-pb-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = PersonalBestStore::new(dir.clone());
        assert!(store.is_empty());
        let records = [record("a", 100, 60_000, 600_000, false), record("b", 200, 60_000, 60_000, false)];
        assert_eq!(store.backfill(records.iter(), "TooWhole"), 2);
        let reopened = PersonalBestStore::new(dir.clone());
        assert_eq!(reopened.list().len(), 2);
        assert!(reopened.consider(&record("c", 100, 60_000, 6_000_000, false), Some("TooWhole"), None, true).is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
