//! TooWholesome DPS: the pet collection, read from the game's traffic.
//!
//! `capture::pet_wire` decodes the messages; this keeps the collection the
//! last login sent, applies the soul and rank changes since, saves it to
//! `pets.json`, and tells the overlay ("pets-changed"). The pet list
//! (`src/data/pets.json`) comes from PetTracker by 0Fox2Give (GPL-3.0).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{LazyLock, OnceLock};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::capture::pet_nav::{Nearby, PetNav};
use crate::capture::pet_wire::{goal, PetEvent};

#[derive(Deserialize)]
struct CatalogEntry {
    id: i32,
    name: String,
    family: String,
}

static CATALOG: LazyLock<Vec<CatalogEntry>> =
    LazyLock::new(|| serde_json::from_str(include_str!("../../src/data/pets.json")).unwrap_or_default());

/// Monster npc code -> the pet whose souls it drops (from PetTracker's sources).
static PET_SOURCES: LazyLock<HashMap<i32, i32>> = LazyLock::new(|| {
    serde_json::from_str::<HashMap<String, i32>>(include_str!("../../src/data/pet_sources.json"))
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(npc, pet)| Some((npc.parse().ok()?, pet)))
        .collect()
});

static NAV: LazyLock<Mutex<PetNav>> = LazyLock::new(|| Mutex::new(PetNav::default()));

pub fn nav_frame(local: i32, op: u8, family: u8, body: &[u8]) {
    NAV.lock().frame(local, op, family, body, crate::clock::now_ms(), |npc| PET_SOURCES.get(&npc).copied());
}

/// Pets whose monsters are around you, nearest first, with a direction when known.
#[tauri::command]
pub fn get_pet_nearby() -> Vec<Nearby> {
    NAV.lock().nearby(crate::clock::now_ms())
}

/// Which pet each monster's souls go to, so the overlay can follow what you hunt.
#[tauri::command]
pub fn get_pet_sources() -> HashMap<i32, i32> {
    PET_SOURCES.clone()
}

pub fn is_pet(id: i32) -> bool {
    CATALOG.iter().any(|p| p.id == id)
}

fn name_of(id: i32) -> String {
    CATALOG.iter().find(|p| p.id == id).map_or_else(|| format!("Pet #{id}"), |p| p.name.clone())
}

// shortcut: one collection (the last character to log in), not one per character; key by name if players ask.
#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Collection {
    character: String,
    /// 0 until a login has been seen: ranks are unknown, not zero.
    synced_at_ms: i64,
    equipped: i32,
    ranks: HashMap<i32, i32>,
    souls: HashMap<i32, i32>,
}

struct Store {
    path: PathBuf,
    app: tauri::AppHandle,
}

static STORE: OnceLock<Store> = OnceLock::new();
static STATE: Mutex<Option<Collection>> = Mutex::new(None);

pub fn init(app_data_dir: PathBuf, app: tauri::AppHandle) {
    let path = app_data_dir.join("pets.json");
    let saved = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok());
    *STATE.lock() = Some(saved.unwrap_or_default());
    let _ = STORE.set(Store { path, app });
}

/// Fold one decoded message into the collection, save it and tell the page.
pub fn apply(event: PetEvent, character: Option<String>) {
    let Some(store) = STORE.get() else { return };
    let mut guard = STATE.lock();
    let c = guard.get_or_insert_with(Collection::default);
    let notice = match &event {
        PetEvent::Snapshot { equipped, ranks, souls } => {
            c.equipped = *equipped;
            c.ranks = ranks.iter().copied().collect();
            c.souls = souls.iter().copied().collect();
            c.synced_at_ms = crate::clock::now_ms();
            if let Some(name) = character.filter(|n| !n.trim().is_empty()) {
                c.character = name;
            }
            serde_json::json!({ "kind": "sync" })
        }
        PetEvent::SoulsGained { id, souls } => {
            *c.souls.entry(*id).or_default() += souls;
            serde_json::json!({ "kind": "souls", "id": id, "name": name_of(*id), "souls": souls })
        }
        PetEvent::SoulsSpent { id, souls } => {
            let left = c.souls.entry(*id).or_default();
            *left = (*left - souls).max(0);
            serde_json::json!({ "kind": "spent", "id": id })
        }
        PetEvent::Rank { id, rank } => {
            c.ranks.insert(*id, *rank);
            serde_json::json!({ "kind": "rank", "id": id, "name": name_of(*id), "rank": rank })
        }
    };
    if let Ok(json) = serde_json::to_string(&*c) {
        if let Err(e) = crate::atomic_file::write(&store.path, json.as_bytes()) {
            tracing::warn!("Could not save the pet collection: {e}");
        }
    }
    drop(guard);
    let _ = store.app.emit("pets-changed", notice);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetRow {
    id: i32,
    name: String,
    family: String,
    /// `None` until a login has been seen.
    rank: Option<i32>,
    souls: i32,
    /// Souls for the next rank; `None` at rank 3 (max).
    goal: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetsView {
    character: String,
    synced_at_ms: i64,
    equipped: i32,
    pets: Vec<PetRow>,
}

#[tauri::command]
pub fn get_pets() -> PetsView {
    let c = STATE.lock().clone().unwrap_or_default();
    let synced = c.synced_at_ms > 0;
    let mut pets: Vec<PetRow> = CATALOG
        .iter()
        .map(|p| {
            let rank = synced.then(|| c.ranks.get(&p.id).copied().unwrap_or(0));
            PetRow {
                id: p.id,
                name: p.name.clone(),
                family: p.family.clone(),
                rank,
                souls: c.souls.get(&p.id).copied().unwrap_or(0),
                goal: rank.and_then(goal),
            }
        })
        .collect();
    pets.sort_by(|a, b| a.name.cmp(&b.name));
    PetsView { character: c.character, synced_at_ms: c.synced_at_ms, equipped: c.equipped, pets }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_pet_list_loads() {
        assert!(super::CATALOG.len() >= 300);
        assert!(super::is_pet(1001) && !super::is_pet(42));
        assert!(super::PET_SOURCES.len() > 400);
        assert!(super::PET_SOURCES.values().all(|&p| super::is_pet(p)));
    }
}
