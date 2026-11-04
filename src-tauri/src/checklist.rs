//! TooWholesome DPS: what the game said about each character's limits, for
//! the Checklist to tick itself (`capture::game_counters` decodes it).
//!
//! Kept per character (`<server>:<name>`) in `checklist_game.json`, shaped as
//! Nyerk's task logic reads it (`public/src/js/taskLogic.js`, `fromGame`):
//! `tickets {id: {n, ms, at}}`, `ticketsAt`, `missions {key: [value, tiers]}`,
//! `pvp {mode: {rating, wins, losses}}`, `duties`, `shops`, `benefits`.
//!
//! A zone entry sends its lists before the character record that says whose
//! they are, so lists wait briefly and go to whoever is logged in once the
//! record has had time to arrive (Nyerk's `pending`).

use std::path::PathBuf;
use std::sync::OnceLock;

use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use tauri::Emitter;

use crate::capture::game_counters::GameCounter;

/// How long a zone entry's lists wait for the character record.
const PENDING_MS: i64 = 5_000;

#[derive(Default)]
struct State {
    chars: Map<String, Value>,
    current: Option<String>,
    pending: Map<String, Value>,
    pending_at: i64,
    pending_for: Option<String>,
}

struct Store {
    path: PathBuf,
    app: tauri::AppHandle,
}

static STORE: OnceLock<Store> = OnceLock::new();
static STATE: Mutex<Option<State>> = Mutex::new(None);

pub fn init(app_data_dir: PathBuf, app: tauri::AppHandle) {
    let path = app_data_dir.join("checklist_game.json");
    let chars = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<Map<String, Value>>(&t).ok())
        .unwrap_or_default();
    *STATE.lock() = Some(State { chars, ..State::default() });
    let _ = STORE.set(Store { path, app });
}

fn obj(v: &mut Value) -> &mut Map<String, Value> {
    if !v.is_object() {
        *v = json!({});
    }
    v.as_object_mut().unwrap()
}

fn sub<'a>(m: &'a mut Map<String, Value>, key: &str) -> &'a mut Map<String, Value> {
    obj(m.entry(key.to_string()).or_insert_with(|| json!({})))
}

impl State {
    fn char_mut(&mut self, key: &str) -> &mut Map<String, Value> {
        sub(&mut self.chars, key)
    }

    /// Lists waiting for the character record go to whoever is logged in.
    fn settle(&mut self, now: i64) -> bool {
        let Some(current) = self.current.clone() else { return false };
        if self.pending.is_empty() || (self.pending_for.as_ref() == Some(&current) && now - self.pending_at < PENDING_MS) {
            return false;
        }
        let pending = std::mem::take(&mut self.pending);
        let c = self.char_mut(&current);
        for (k, v) in pending {
            if k == "shops" {
                let shops = sub(c, "shops");
                for (shop, items) in v.as_object().cloned().unwrap_or_default() {
                    shops.insert(shop, items);
                }
            } else {
                c.insert(k, v);
            }
        }
        true
    }

    fn apply(&mut self, counter: GameCounter, now: i64) {
        let list = counter.is_list();
        if list && self.pending.is_empty() {
            self.pending_at = now;
            self.pending_for = self.current.clone();
        }
        // Lists wait (even before anyone is known: the first login); a change goes to the
        // lists being read, else to whoever is logged in.
        let target: &mut Map<String, Value> = if list || !self.pending.is_empty() {
            &mut self.pending
        } else {
            let Some(current) = self.current.clone() else { return };
            self.char_mut(&current)
        };
        match counter {
            GameCounter::Tickets(tickets) => {
                let all: Map<String, Value> = tickets
                    .into_iter()
                    .map(|(id, t)| (id.to_string(), with_at(serde_json::to_value(t).unwrap_or_default(), now)))
                    .collect();
                target.insert("tickets".into(), Value::Object(all));
                target.insert("ticketsAt".into(), json!(now));
            }
            GameCounter::Ticket(id, t) => {
                sub(target, "tickets").insert(id.to_string(), with_at(serde_json::to_value(t).unwrap_or_default(), now));
            }
            GameCounter::Missions(list) => {
                let all: Map<String, Value> = list.into_iter().map(|(k, v, t)| (k.to_string(), json!([v, t]))).collect();
                target.insert("missions".into(), Value::Object(all));
                target.insert("missionsAt".into(), json!(now));
            }
            GameCounter::Mission(k, v, t) => {
                sub(target, "missions").insert(k.to_string(), json!([v, t]));
                target.insert("missionsAt".into(), json!(now));
            }
            GameCounter::Pvp(modes) => {
                let all: Map<String, Value> = modes
                    .into_iter()
                    .map(|(mode, rating, wins, losses)| (mode.to_string(), json!({ "rating": rating, "wins": wins, "losses": losses })))
                    .collect();
                target.insert("pvp".into(), Value::Object(all));
                target.insert("pvpAt".into(), json!(now));
            }
            GameCounter::Duties { refreshes, done, quests } => {
                let quests: Map<String, Value> = quests.into_iter().map(|(q, s)| (q.to_string(), json!(s))).collect();
                target.insert("duties".into(), json!({ "refreshes": refreshes, "done": done, "quests": quests }));
                target.insert("dutiesAt".into(), json!(now));
            }
            GameCounter::Shop { shop, items, whole } => {
                let kept = sub(sub(target, "shops"), &shop.to_string());
                if whole {
                    kept.clear();
                }
                for (item, count) in items {
                    kept.insert(item.to_string(), json!(count));
                }
                kept.insert("at".into(), json!(now));
            }
            GameCounter::Benefits(list) => {
                let all: Map<String, Value> = list.into_iter().map(|(id, start, end)| (id.to_string(), json!([start, end]))).collect();
                target.insert("benefits".into(), Value::Object(all));
                target.insert("benefitsAt".into(), json!(now));
            }
        }
    }
}

fn with_at(mut v: Value, now: i64) -> Value {
    obj(&mut v).insert("at".into(), json!(now));
    v
}

/// One decoded counter, with who is logged in (`name`, `server`) as the meter knows it.
pub fn observe(counter: GameCounter, name: Option<String>, server: u16) {
    let Some(store) = STORE.get() else { return };
    let now = crate::clock::now_ms();
    let mut guard = STATE.lock();
    let state = guard.get_or_insert_with(State::default);
    if let Some(name) = name.filter(|n| !n.trim().is_empty()) {
        let key = format!("{server}:{name}");
        let c = state.char_mut(&key);
        c.insert("name".into(), json!(name));
        c.insert("server".into(), json!(server));
        state.current = Some(key);
    }
    state.apply(counter, now);
    state.settle(now);
    let json = serde_json::to_string(&state.chars).unwrap_or_default();
    drop(guard);
    if let Err(e) = crate::atomic_file::write(&store.path, json.as_bytes()) {
        tracing::warn!("Could not save checklist counters: {e}");
    }
    let _ = store.app.emit("checklist-game", ());
}

/// Every character's counters, and who is logged in.
#[tauri::command]
pub fn get_checklist_game() -> Value {
    let mut guard = STATE.lock();
    let state = guard.get_or_insert_with(State::default);
    state.settle(crate::clock::now_ms());
    json!({ "chars": state.chars, "current": state.current })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::game_counters::Ticket;

    fn tickets(n: i64) -> GameCounter {
        GameCounter::Tickets(vec![(4, Ticket { ms: vec![], n: vec![n] })])
    }

    #[test]
    fn a_zone_entrys_lists_go_to_the_character_after_the_wait() {
        let mut s = State { current: Some("1104:A".into()), ..State::default() };
        s.apply(tickets(9), 1000);
        assert!(!s.settle(1500), "still waiting for the character record");
        assert!(s.settle(1000 + PENDING_MS));
        assert_eq!(s.chars["1104:A"]["tickets"]["4"]["n"], json!([9]));
        assert_eq!(s.chars["1104:A"]["ticketsAt"], json!(1000));

        // A change after that goes straight to the character.
        s.apply(GameCounter::Ticket(4, Ticket { ms: vec![], n: vec![7] }), 9000);
        assert_eq!(s.chars["1104:A"]["tickets"]["4"]["n"], json!([7]));
    }

    #[test]
    fn lists_before_anyone_is_known_wait_for_the_first_character() {
        let mut s = State::default();
        s.apply(tickets(5), 1000);
        assert!(!s.settle(1100));
        s.current = Some("1104:A".into());
        assert!(s.settle(1200));
        assert_eq!(s.chars["1104:A"]["tickets"]["4"]["n"], json!([5]));
    }

    #[test]
    fn a_relog_onto_another_character_gives_it_the_lists_at_once() {
        let mut s = State { current: Some("1104:A".into()), ..State::default() };
        s.apply(tickets(3), 1000);
        s.current = Some("1104:B".into());
        assert!(s.settle(1200));
        assert_eq!(s.chars["1104:B"]["tickets"]["4"]["n"], json!([3]));
        assert!(s.chars.get("1104:A").is_none());
    }
}
