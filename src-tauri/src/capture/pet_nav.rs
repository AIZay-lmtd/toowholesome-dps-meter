//! Where the monsters that drop pet souls are, relative to you.
//!
//! Ported from PetTracker by 0Fox2Give (GPL-3.0,
//! https://github.com/0Fox2Give/PetTracker, `src/Core/SkillNavigation.cs`,
//! marked experimental there). Monsters come from spawn messages (`40/41/42
//! 36`) and their movement (`37`); your own position only from your skill
//! casts and self-buffs (`38 02`, `38 2A/2B`) and action poses (`37 3C`),
//! so it is known for a couple of seconds after you act. Anything stale is
//! dropped rather than shown wrong.
//!
//! The bearing is map-relative (north up, as the minimap draws it), in
//! degrees clockwise from up.

use std::collections::HashMap;

/// A position older than this is not shown.
pub const LIFETIME_MS: i64 = 2000;
const CAPACITY: usize = 2048;

type Point = (f64, f64, f64);

#[derive(Clone)]
struct Mob {
    pet: i32,
    point: Option<Point>,
    at: i64,
    walking: bool,
    stopped: bool,
}

#[derive(Default)]
pub struct PetNav {
    self_id: i32,
    mobs: HashMap<i32, Mob>,
    last_frame: i64,
    position: Option<Point>,
    position_at: i64,
}

/// One pet whose monsters are around you.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Nearby {
    pub pet_id: i32,
    /// Degrees clockwise from map north; `None` while your position is unknown.
    pub bearing: Option<f64>,
    /// Straight-line distance in game units to the nearest one.
    pub distance: Option<f64>,
}

/// A minimal varint of up to 5 bytes (PetTracker's `GameProtocol.Var`).
fn var(b: &[u8], p: &mut usize) -> Option<i32> {
    let start = *p;
    let mut n: i64 = 0;
    for i in 0..5 {
        let v = *b.get(*p)?;
        *p += 1;
        if i == 4 && (v & 0xf8) != 0 {
            *p = start;
            return None;
        }
        n |= ((v & 127) as i64) << (7 * i);
        if v < 128 {
            let ok = n <= i32::MAX as i64 && (i == 0 || n >= 1 << (7 * i));
            return ok.then_some(n as i32);
        }
    }
    *p = start;
    None
}

fn f32_at(b: &[u8], p: usize) -> Option<f64> {
    Some(f32::from_le_bytes(b.get(p..p + 4)?.try_into().ok()?) as f64)
}

fn i32_at(b: &[u8], p: usize) -> Option<i32> {
    Some(i32::from_le_bytes(b.get(p..p + 4)?.try_into().ok()?))
}

fn point(b: &[u8], p: usize) -> Option<Point> {
    let (x, y, z) = (f32_at(b, p)?, f32_at(b, p + 4)?, f32_at(b, p + 8)?);
    [x, y, z].iter().all(|v| v.is_finite() && v.abs() < 1e7).then_some((x, y, z))
}

/// `(entity, npc code)` of a spawn (`40/41/42 36`), not a summon.
fn appearance(op: u8, family: u8, b: &[u8]) -> Option<(i32, i32)> {
    if family != 0x36 || !matches!(op, 0x40..=0x42) {
        return None;
    }
    let mut p = 0;
    let entity = var(b, &mut p).filter(|&e| e > 0)?;
    if p + 3 > b.len() || (b[p] & 0x1f) == 0x1f {
        return None;
    }
    p += 3;
    [p + 2, p].into_iter().find_map(|at| {
        let npc = i32_at(b, at)?;
        ((1_000_000..=10_000_000).contains(&npc) && *b.get(at + 5)? == 2).then_some((entity, npc))
    })
}

fn spawn_point(b: &[u8], entity: i32, npc: i32) -> Option<Point> {
    let mut p = 0;
    if var(b, &mut p)? != entity {
        return None;
    }
    p += 3;
    (i32_at(b, p)? == npc && *b.get(p + 4)? == 0 && *b.get(p + 5)? == 2).then_some(())?;
    point(b, p + 6)
}

fn removal(op: u8, family: u8, b: &[u8]) -> Option<i32> {
    let mut p = 0;
    if op != 0x42 || family != 0x36 {
        return None;
    }
    let entity = var(b, &mut p).filter(|&e| e > 0)?;
    (b.len() == p + 2 && b[p] == 0).then_some(entity)
}

/// Your own position from an action pose (`37 3C`).
fn action_pose(b: &[u8]) -> Option<(i32, Point)> {
    let mut p = 0;
    let entity = var(b, &mut p).filter(|&e| e > 0)?;
    if p + 29 > b.len() || b[p] != 3 {
        return None;
    }
    p += 1;
    let pt = point(b, p)?;
    p += 12;
    let yaw = f32_at(b, p)?;
    p += 4;
    if !yaw.is_finite() || !(-180.0..=360.0).contains(&yaw) {
        return None;
    }
    let flags_ok = (b[p] == 0 && b[p + 1] == 0) || (b[p] == 7 && b[p + 1] == 2);
    if !flags_ok || b[p + 2] != 1 {
        return None;
    }
    p += 3;
    let skill = i32_at(b, p)? as u32;
    p += 8;
    if !(11_000_000..20_000_000).contains(&skill) {
        return None;
    }
    var(b, &mut p)?;
    (p == b.len()).then_some((entity, pt))
}

/// `(entity, point if this movement form carries one)` for family `37`.
fn movement(op: u8, b: &[u8]) -> Option<(i32, Option<Point>)> {
    if !matches!(op, 0x1a..=0x1e | 0x3c) {
        return None;
    }
    let mut p = 0;
    let entity = var(b, &mut p).filter(|&e| e > 0)?;
    let first = *b.get(p)?;
    let pt = match op {
        0x1d | 0x1e | 0x3c => None,
        0x1a => point(b, p + 2),
        _ => point(b, p + 1 + usize::from(first & 1 != 0)),
    };
    Some((entity, pt))
}

fn npc_walk(op: u8, b: &[u8]) -> bool {
    let mut p = 0;
    matches!(op, 0x1b | 0x1c)
        && var(b, &mut p).is_some()
        && b.len() == p + 18
        && b[p] == 4
        && b[b.len() - 1] == 1
        && point(b, p + 1).is_some()
}

fn npc_stop(op: u8, b: &[u8]) -> bool {
    let mut p = 0;
    op == 0x1a && var(b, &mut p).is_some() && b.len() == p + 16 && b[p] == 0 && b[p + 1] == 0 && point(b, p + 2).is_some()
}

/// Your position from a self-buff (`38 2A`, or `38 2B` as an update).
fn self_buff(b: &[u8], update: bool) -> Option<(i32, Point)> {
    let mut p = 0;
    let entity = var(b, &mut p).filter(|&e| e > 0)?;
    if !update && var(b, &mut p)? != 1 {
        return None;
    }
    let flags = *b.get(p)?;
    p += 1;
    if !matches!(flags, 0x11 | 0x13) {
        return None;
    }
    var(b, &mut p)?;
    if p + 20 > b.len() {
        return None;
    }
    p += 20;
    if var(b, &mut p)? != entity || p >= b.len() {
        return None;
    }
    p += 1;
    if flags == 0x13 {
        p += 4;
    }
    (p + 13 == b.len() && b[p] == if update { 2 } else { 0 }).then_some(())?;
    Some((entity, point(b, p + 1)?))
}

/// A skill cast (`38 02`): `(actor, target, skill, target point)`.
fn cast(b: &[u8]) -> Option<(i32, i32, u32, Option<Point>)> {
    let mut p = 0;
    let actor = var(b, &mut p).filter(|&a| a > 0)?;
    if p + 7 > b.len() || b[p] != 0 {
        return None;
    }
    let skill = i32_at(b, p + 1)? as u32;
    let flags = b[p + 6];
    p += 7;
    if !(11_000_000..20_000_000).contains(&skill) || !matches!(flags, 0 | 2) {
        return None;
    }
    let target = var(b, &mut p).filter(|&t| t > 0)?;
    let yaw = f32_at(b, p)?;
    p += 4;
    if !yaw.is_finite() || !(-180.0..=360.0).contains(&yaw) {
        return None;
    }
    let mut pt = None;
    if flags == 2 {
        pt = Some(point(b, p)?);
        p += 12;
    }
    for _ in 0..3 {
        var(b, &mut p)?;
    }
    (p == b.len()).then_some((actor, target, skill, pt))
}

fn fresh(at: i64, now: i64) -> bool {
    at <= now && now - at < LIFETIME_MS
}

impl PetNav {
    pub fn clear(&mut self) {
        *self = PetNav::default();
    }

    /// One message. `local` is your entity id; `pet_of` maps a monster's npc
    /// code to the pet whose souls it drops.
    pub fn frame(&mut self, local: i32, op: u8, family: u8, body: &[u8], now: i64, pet_of: impl Fn(i32) -> Option<i32>) {
        if local <= 0 {
            self.clear();
            return;
        }
        if local != self.self_id {
            self.clear();
            self.self_id = local;
        }
        // A stop is only trusted while the stream is unbroken.
        if !fresh(self.last_frame, now) {
            for mob in self.mobs.values_mut() {
                mob.walking = false;
                mob.stopped = false;
            }
        }
        self.last_frame = now;
        if family == 0x36 && op == 0x23 {
            // Zone change.
            self.clear();
            self.self_id = local;
            return;
        }
        if let Some(entity) = removal(op, family, body) {
            self.mobs.remove(&entity);
            if entity == self.self_id {
                self.clear();
                self.self_id = local;
            }
            return;
        }
        if let Some((entity, npc)) = appearance(op, family, body) {
            self.mobs.remove(&entity);
            if let Some(pet) = pet_of(npc) {
                if self.mobs.len() >= CAPACITY {
                    if let Some(oldest) = self.mobs.iter().min_by_key(|(_, m)| m.at).map(|(&k, _)| k) {
                        self.mobs.remove(&oldest);
                    }
                }
                let pt = if op == 0x41 { spawn_point(body, entity, npc) } else { None };
                self.mobs.insert(entity, Mob { pet, point: pt, at: now, walking: false, stopped: false });
            }
            return;
        }
        if family == 0x37 && op == 0x3c {
            if let Some((entity, pt)) = action_pose(body) {
                if entity == self.self_id {
                    self.position = Some(pt);
                    self.position_at = now;
                } else if let Some(mob) = self.mobs.get_mut(&entity) {
                    mob.point = Some(pt);
                    mob.at = now;
                    mob.walking = false;
                    mob.stopped = false;
                }
                return;
            }
        }
        if family == 0x37 {
            if let Some((entity, pt)) = movement(op, body) {
                if entity == self.self_id {
                    // Your own movement forms are not decoded: drop the fix.
                    self.position = None;
                    self.position_at = now;
                } else if let Some(mob) = self.mobs.get_mut(&entity) {
                    let walk = npc_walk(op, body);
                    let stop = mob.walking && npc_stop(op, body);
                    mob.walking = walk || (op == 0x1d && mob.walking);
                    mob.stopped = stop;
                    mob.point = pt;
                    mob.at = now;
                }
                return;
            }
        }
        // Combat can move a monster (or you) in ways not decoded here.
        if family == 0x37 || family == 0x38 {
            let mut p = 0;
            if let Some(actor) = var(body, &mut p) {
                if let Some(mob) = self.mobs.get_mut(&actor) {
                    mob.walking = false;
                    mob.stopped = false;
                    mob.point = None;
                }
                if actor == self.self_id && (family == 0x37 || matches!(op, 0x14 | 0x15)) {
                    self.position = None;
                }
            }
        }
        if family == 0x38 && matches!(op, 0x2a | 0x2b) {
            if let Some((entity, pt)) = self_buff(body, op == 0x2b) {
                if entity == self.self_id {
                    self.position = Some(pt);
                    self.position_at = now;
                    return;
                }
            }
        }
        if family == 0x38 && op == 0x02 {
            let mut p = 0;
            if var(body, &mut p) != Some(self.self_id) {
                return;
            }
            let Some((_, target, skill, target_point)) = cast(body) else {
                self.position = None;
                return;
            };
            // A dodge's coordinates are a displacement, not a position.
            if skill % 1_000_000 < 10_000 {
                self.position = None;
                return;
            }
            if let (true, Some(pt), Some(mob)) = (target != self.self_id, target_point, self.mobs.get_mut(&target)) {
                mob.point = Some(pt);
                mob.at = now;
            }
        }
    }

    fn usable(&self, mob: &Mob, now: i64) -> bool {
        mob.point.is_some() && mob.at <= now && (fresh(mob.at, now) || (mob.stopped && fresh(self.last_frame, now)))
    }

    /// Every pet with a monster around you, with a bearing and distance to
    /// the nearest one when both positions are fresh.
    pub fn nearby(&self, now: i64) -> Vec<Nearby> {
        let mut by_pet: HashMap<i32, Vec<&Mob>> = HashMap::new();
        for mob in self.mobs.values() {
            by_pet.entry(mob.pet).or_default().push(mob);
        }
        let here = self.position.filter(|_| fresh(self.position_at, now));
        let mut out: Vec<Nearby> = by_pet
            .into_iter()
            .map(|(pet_id, mobs)| {
                let mut guide = Nearby { pet_id, bearing: None, distance: None };
                // A stale one could be the nearest: no guidance rather than a wrong one.
                let (Some(me), true) = (here, mobs.iter().all(|m| self.usable(m, now))) else { return guide };
                let nearest = mobs
                    .iter()
                    .filter_map(|m| m.point)
                    .map(|(x, y, _)| (x - me.0, y - me.1))
                    .min_by(|a, b| (a.0 * a.0 + a.1 * a.1).total_cmp(&(b.0 * b.0 + b.1 * b.1)));
                if let Some((dx, dy)) = nearest.filter(|(dx, dy)| dx * dx + dy * dy >= 1.0) {
                    // Minimap: +X right, +Y down; the arrow starts pointing up.
                    guide.bearing = Some((dy.atan2(dx).to_degrees() + 90.0).rem_euclid(360.0));
                    guide.distance = Some((dx * dx + dy * dy).sqrt());
                }
                guide
            })
            .collect();
        out.sort_by(|a, b| a.distance.unwrap_or(f64::MAX).total_cmp(&b.distance.unwrap_or(f64::MAX)));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ME: i32 = 700;
    const MOB: i32 = 900;
    const NPC: i32 = 2_000_926;
    const PET: i32 = 1066;

    fn pet_of(npc: i32) -> Option<i32> {
        (npc == NPC).then_some(PET)
    }

    fn v(n: i32) -> Vec<u8> {
        let mut out = Vec::new();
        let mut n = n as u32;
        loop {
            let b = (n & 0x7f) as u8;
            n >>= 7;
            if n == 0 {
                out.push(b);
                return out;
            }
            out.push(b | 0x80);
        }
    }

    fn pt(x: f32, y: f32, z: f32) -> Vec<u8> {
        [x.to_le_bytes(), y.to_le_bytes(), z.to_le_bytes()].concat()
    }

    /// `41 36` spawn with its position.
    fn spawn(x: f32, y: f32) -> Vec<u8> {
        let mut b = v(MOB);
        b.extend([0, 0, 0]);
        b.extend(NPC.to_le_bytes());
        b.extend([0, 2]);
        b.extend(pt(x, y, 0.0));
        b
    }

    /// `38 2A` self-buff carrying your position.
    fn self_buff_at(x: f32, y: f32) -> Vec<u8> {
        let mut b = v(ME);
        b.extend(v(1));
        b.push(0x11);
        b.extend(v(5));
        b.extend([0u8; 20]);
        b.extend(v(ME));
        b.push(0);
        b.push(0);
        b.extend(pt(x, y, 0.0));
        b
    }

    #[test]
    fn points_at_a_spawned_pet_monster_once_your_position_is_known() {
        let mut nav = PetNav::default();
        nav.frame(ME, 0x41, 0x36, &spawn(100.0, 0.0), 1000, pet_of);
        // Seen, but where you are is not known yet.
        assert_eq!(nav.nearby(1000), vec![Nearby { pet_id: PET, bearing: None, distance: None }]);

        nav.frame(ME, 0x2a, 0x38, &self_buff_at(0.0, 0.0), 1100, pet_of);
        let n = &nav.nearby(1200)[0];
        assert_eq!(n.pet_id, PET);
        assert!((n.bearing.unwrap() - 90.0).abs() < 1e-6, "{n:?}"); // +X is to the right: east
        assert!((n.distance.unwrap() - 100.0).abs() < 1e-6);

        // Two seconds later both fixes are stale: no arrow rather than a wrong one.
        assert_eq!(nav.nearby(3500)[0].bearing, None);
    }

    #[test]
    fn despawns_and_zone_changes_forget_monsters() {
        let mut nav = PetNav::default();
        nav.frame(ME, 0x41, 0x36, &spawn(10.0, 10.0), 1000, pet_of);
        let mut gone = v(MOB);
        gone.extend([0, 3]);
        nav.frame(ME, 0x42, 0x36, &gone, 1100, pet_of);
        assert!(nav.nearby(1100).is_empty());

        nav.frame(ME, 0x41, 0x36, &spawn(10.0, 10.0), 1200, pet_of);
        nav.frame(ME, 0x23, 0x36, &[], 1300, pet_of);
        assert!(nav.nearby(1300).is_empty());
    }

    #[test]
    fn monsters_that_drop_no_pet_souls_are_ignored() {
        let mut nav = PetNav::default();
        nav.frame(ME, 0x41, 0x36, &spawn(10.0, 10.0), 1000, |_| None);
        assert!(nav.nearby(1000).is_empty());
    }
}
