//! The pet collection on the wire: family `0x90`.
//!
//! Ported from PetTracker by 0Fox2Give (GPL-3.0,
//! https://github.com/0Fox2Give/PetTracker, `src/Core/CollectionWire.cs`),
//! which verified these layouts against captures:
//!
//! - `00 90` login snapshot: equipped pet `u32`, varint rank count, then
//!   `(id u32, id u32 again, rank u32)` per owned pet, then varint soul count
//!   and `(id u32, souls u32)` per pet with progress.
//! - `0D 90` souls gained: varint count, `(id u32, souls u32)` each.
//! - `0E 90` souls spent on a rank-up: same layout.
//! - `14 90` rank-up result (23 bytes): status `u16` 0, id `u32`, rank `u32`.
//!
//! Every id must be a known pet (`is_pet`), so another `0x90` message that
//! happens to fit a layout is not mistaken for one.

#[derive(Debug, Clone, PartialEq)]
pub enum PetEvent {
    Snapshot { equipped: i32, ranks: Vec<(i32, i32)>, souls: Vec<(i32, i32)> },
    SoulsGained { id: i32, souls: i32 },
    SoulsSpent { id: i32, souls: i32 },
    Rank { id: i32, rank: i32 },
}

fn u32_at(b: &[u8], at: usize) -> Option<i32> {
    Some(i32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// A count: at most three varint bytes, minimally encoded.
fn count_at(b: &[u8], at: &mut usize) -> Option<usize> {
    let mut value = 0usize;
    for n in 0..3 {
        let byte = *b.get(*at)?;
        *at += 1;
        value |= ((byte & 0x7f) as usize) << (7 * n);
        if byte < 0x80 {
            return (n == 0 || value >= 1 << (7 * n)).then_some(value);
        }
    }
    None
}

/// The rank's soul goal: 5 to unlock, 25 to rank 2, 75 to rank 3 (max).
pub fn goal(rank: i32) -> Option<i32> {
    match rank {
        0 => Some(5),
        1 => Some(25),
        2 => Some(75),
        _ => None,
    }
}

/// `packet` is one whole frame: varint length, opcode, family, body.
pub fn decode(packet: &[u8], is_pet: impl Fn(i32) -> bool) -> Vec<PetEvent> {
    let header = super::stream_processor::read_varint(packet, 0).length;
    if header <= 0 {
        return Vec::new();
    }
    let header = header as usize;
    let (Some(&op), Some(&family)) = (packet.get(header), packet.get(header + 1)) else { return Vec::new() };
    if family != 0x90 {
        return Vec::new();
    }
    let body = &packet[header + 2..];
    match op {
        0x0d | 0x0e => batch(op, body, &is_pet),
        0x14 if body.len() == 23 && body[0] == 0 && body[1] == 0 => {
            let (Some(id), Some(rank)) = (u32_at(body, 2), u32_at(body, 6)) else { return Vec::new() };
            if is_pet(id) && (1..=3).contains(&rank) { vec![PetEvent::Rank { id, rank }] } else { Vec::new() }
        }
        0x00 => snapshot(body, &is_pet).into_iter().collect(),
        _ => Vec::new(),
    }
}

fn batch(op: u8, body: &[u8], is_pet: &impl Fn(i32) -> bool) -> Vec<PetEvent> {
    let mut at = 0;
    let Some(count) = count_at(body, &mut at) else { return Vec::new() };
    if count == 0 || count > 400 || body.len() - at != count * 8 {
        return Vec::new();
    }
    let mut events = Vec::with_capacity(count);
    let mut seen = std::collections::HashSet::new();
    for _ in 0..count {
        let (Some(id), Some(souls)) = (u32_at(body, at), u32_at(body, at + 4)) else { return Vec::new() };
        at += 8;
        if !is_pet(id) || !seen.insert(id) || !(1..=75).contains(&souls) {
            return Vec::new();
        }
        events.push(if op == 0x0d { PetEvent::SoulsGained { id, souls } } else { PetEvent::SoulsSpent { id, souls } });
    }
    events
}

fn snapshot(body: &[u8], is_pet: &impl Fn(i32) -> bool) -> Option<PetEvent> {
    let equipped = u32_at(body, 0)?;
    if equipped != 0 && !is_pet(equipped) {
        return None;
    }
    let mut at = 4;
    let count = count_at(body, &mut at)?;
    if count > (body.len() - at) / 12 {
        return None;
    }
    let mut ranks = Vec::with_capacity(count);
    for _ in 0..count {
        let (id, again, rank) = (u32_at(body, at)?, u32_at(body, at + 4)?, u32_at(body, at + 8)?);
        at += 12;
        if !is_pet(id) || again != id || !(1..=3).contains(&rank) || ranks.iter().any(|&(i, _)| i == id) {
            return None;
        }
        ranks.push((id, rank));
    }
    if equipped != 0 && !ranks.iter().any(|&(i, _)| i == equipped) {
        return None;
    }
    let count = count_at(body, &mut at)?;
    if count > (body.len() - at) / 8 {
        return None;
    }
    let mut souls = Vec::with_capacity(count);
    for _ in 0..count {
        let (id, value) = (u32_at(body, at)?, u32_at(body, at + 4)?);
        at += 8;
        let rank = ranks.iter().find(|&&(i, _)| i == id).map_or(0, |&(_, r)| r);
        let cap = if rank == 1 || rank == 2 { goal(rank)? } else { i32::MAX };
        if !is_pet(id) || !(0..=cap).contains(&value) || souls.iter().any(|&(i, _)| i == id) {
            return None;
        }
        souls.push((id, value));
    }
    Some(PetEvent::Snapshot { equipped, ranks, souls })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_pet(id: i32) -> bool {
        (1001..=1300).contains(&id)
    }

    fn frame(op: u8, body: &[u8]) -> Vec<u8> {
        // The length counts itself as if it were 4 bytes wide (see `framing`).
        let len = body.len() + 2 + 4;
        let mut f = vec![len as u8, op, 0x90];
        f.extend_from_slice(body);
        f
    }

    fn le(v: i32) -> [u8; 4] {
        v.to_le_bytes()
    }

    #[test]
    fn login_snapshot() {
        let mut b = Vec::new();
        b.extend(le(1007));
        b.push(2);
        for (id, rank) in [(1007, 2), (1060, 1)] {
            b.extend(le(id));
            b.extend(le(id));
            b.extend(le(rank));
        }
        b.push(2);
        for (id, souls) in [(1007, 30), (1100, 3)] {
            b.extend(le(id));
            b.extend(le(souls));
        }
        assert_eq!(
            decode(&frame(0x00, &b), is_pet),
            vec![PetEvent::Snapshot { equipped: 1007, ranks: vec![(1007, 2), (1060, 1)], souls: vec![(1007, 30), (1100, 3)] }]
        );
    }

    #[test]
    fn souls_rank_ups_and_rejections() {
        let mut b = vec![2];
        b.extend(le(1007));
        b.extend(le(5));
        b.extend(le(1060));
        b.extend(le(1));
        assert_eq!(
            decode(&frame(0x0d, &b), is_pet),
            vec![PetEvent::SoulsGained { id: 1007, souls: 5 }, PetEvent::SoulsGained { id: 1060, souls: 1 }]
        );
        assert_eq!(decode(&frame(0x0e, &b), is_pet)[0], PetEvent::SoulsSpent { id: 1007, souls: 5 });

        let mut r = vec![0, 0];
        r.extend(le(1007));
        r.extend(le(3));
        r.extend([0u8; 13]);
        assert_eq!(decode(&frame(0x14, &r), is_pet), vec![PetEvent::Rank { id: 1007, rank: 3 }]);

        // An unknown id, a different family, or a short body is not a pet message.
        let mut bad = vec![1];
        bad.extend(le(42));
        bad.extend(le(1));
        assert!(decode(&frame(0x0d, &bad), is_pet).is_empty());
        let mut other = frame(0x0d, &b);
        other[2] = 0x36;
        assert!(decode(&other, is_pet).is_empty());
        assert!(decode(&frame(0x0d, &b[..9]), is_pet).is_empty());
    }
}
