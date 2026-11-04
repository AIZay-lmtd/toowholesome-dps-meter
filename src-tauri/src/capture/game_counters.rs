//! The game's own counters for the checklist: content tickets (entries,
//! keys, Odyle Energy, hours left), weekly mission counters, PvP season
//! records, the duty board, shop purchase counts and paid benefits.
//!
//! Layouts ported from Nyerk by xCROv (GPL-3.0,
//! https://github.com/xCROv/aion2-nyerk, `app/addons/task-list/detect.py`):
//!
//! - `0B 61` every ticket (login, zone entry); `0C 61` one changing.
//!   A ticket is `<kind u8> <id u32>` then, by kind bit: 0x01 a u64, 0x02 a
//!   u64 (times, ms), 0x04 a varint, 0x08 a varint (counts). A value left out
//!   is 0 and keeps its place.
//! - `83 56` every achievement counter; `84 56` one. 17-byte records
//!   `<key u32> <value u32> <changed u64> <tiers u8>`; only the weekly ones
//!   (Season Missions 23x2xxxxx, pass missions 9104xxxxx) are kept.
//! - `2A E3` PvP season records: `<n u8>`, 14 bytes each:
//!   `<mode u8> <rating u32> <4 zero> <wins u8> <losses u8> <2 zero> <streak u8>`.
//! - `1C 8D` the duty board: `<refreshes u32> <turned in u32> …`, duties found
//!   by quest id (< 1000), 4 zero bytes, state 2..4.
//! - `01 8C` a shop's bought counts when it opens; `03 8C` after a purchase.
//! - `3B E3` paid benefits: `<n u8>`, 21 bytes each `<id u32> <u8> <start u64> <end u64>`.

use std::collections::BTreeMap;

use super::stream_processor::read_varint;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Ticket {
    /// Times (ms), when the kind has them.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub ms: Vec<u64>,
    /// Counts: `[stock or left, recharge pool]`.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub n: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GameCounter {
    Tickets(Vec<(u32, Ticket)>),
    Ticket(u32, Ticket),
    Missions(Vec<(u32, u32, u8)>),
    Mission(u32, u32, u8),
    Pvp(Vec<(u8, u32, u8, u8)>),
    Duties { refreshes: u32, done: u32, quests: BTreeMap<u32, u8> },
    Shop { shop: u32, items: Vec<(u32, u32)>, whole: bool },
    Benefits(Vec<(u32, u64, u64)>),
}

impl GameCounter {
    /// Whole lists sent at a zone entry, before the character record says who they belong to.
    pub fn is_list(&self) -> bool {
        matches!(self, Self::Tickets(_) | Self::Missions(_) | Self::Pvp(_) | Self::Benefits(_) | Self::Duties { .. })
    }
}

fn u32_at(b: &[u8], p: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(p..p + 4)?.try_into().ok()?))
}

fn u64_at(b: &[u8], p: usize) -> Option<u64> {
    Some(u64::from_le_bytes(b.get(p..p + 8)?.try_into().ok()?))
}

fn varint(b: &[u8], p: usize) -> Option<(i64, usize)> {
    if p >= b.len() {
        return None;
    }
    let v = read_varint(b, p);
    (v.length > 0).then_some((v.value as i64, v.length as usize))
}

/// A weekly counter: Season Missions (23x2xxxxx) or pass missions (9104xxxxx).
pub fn weekly(key: u32) -> bool {
    ((230_000_000..240_000_000).contains(&key) && (key / 100_000) % 10 == 2) || (910_400_000..910_500_000).contains(&key)
}

/// One ticket at `pos`: `(id, values, next position)`.
fn ticket(b: &[u8], mut pos: usize) -> Option<(u32, Ticket, usize)> {
    let kind = *b.get(pos)?;
    if kind & 0xf0 != 0 {
        return None;
    }
    let id = u32_at(b, pos + 1)?;
    pos += 5;
    let mut t = Ticket { ms: Vec::new(), n: Vec::new() };
    for (i, bit) in [0x01u8, 0x02].into_iter().enumerate() {
        if kind & bit != 0 {
            t.ms.resize(i, 0);
            t.ms.push(u64_at(b, pos)?);
            pos += 8;
        }
    }
    for (i, bit) in [0x04u8, 0x08].into_iter().enumerate() {
        if kind & bit != 0 {
            let (v, len) = varint(b, pos)?;
            t.n.resize(i, 0);
            t.n.push(v);
            pos += len;
        }
    }
    if t.ms.is_empty() && t.n.is_empty() {
        t.n.push(0);
    }
    Some((id, t, pos))
}

/// `packet` is one whole frame: varint length, opcode, family, body.
pub fn decode(packet: &[u8]) -> Option<GameCounter> {
    let header = read_varint(packet, 0).length;
    if header <= 0 {
        return None;
    }
    let h = header as usize;
    let (op, family) = (*packet.get(h)?, *packet.get(h + 1)?);
    let b = &packet[h + 2..];
    match (op, family) {
        (0x0b, 0x61) => {
            let (count, mut pos) = varint(b, 0)?;
            let mut out = Vec::new();
            for _ in 0..count {
                match ticket(b, pos) {
                    Some((id, t, next)) => {
                        out.push((id, t));
                        pos = next;
                    }
                    None => break,
                }
            }
            (!out.is_empty()).then_some(GameCounter::Tickets(out))
        }
        (0x0c, 0x61) => ticket(b, 1).map(|(id, t, _)| GameCounter::Ticket(id, t)),
        (0x83, 0x56) => {
            let (count, mut pos) = varint(b, 0)?;
            if count < 0 || pos + 17 * count as usize > b.len() {
                return None;
            }
            let mut out = Vec::new();
            for _ in 0..count {
                let (key, value) = (u32_at(b, pos)?, u32_at(b, pos + 4)?);
                let tiers = b[pos + 16];
                pos += 17;
                if weekly(key) {
                    out.push((key, value, tiers));
                }
            }
            Some(GameCounter::Missions(out))
        }
        (0x84, 0x56) if b.len() >= 18 => {
            let (key, value) = (u32_at(b, 1)?, u32_at(b, 5)?);
            weekly(key).then_some(GameCounter::Mission(key, value, b[17]))
        }
        (0x2a, 0xe3) => {
            let count = *b.first()? as usize;
            if 1 + 14 * count > b.len() {
                return None;
            }
            let modes = (0..count)
                .map(|i| {
                    let r = &b[1 + 14 * i..15 + 14 * i];
                    (r[0], u32::from_le_bytes([r[1], r[2], r[3], r[4]]), r[9], r[10])
                })
                .collect();
            Some(GameCounter::Pvp(modes))
        }
        (0x1c, 0x8d) if b.len() >= 9 => {
            let (refreshes, done) = (u32_at(b, 0)?, u32_at(b, 4)?);
            let mut quests = BTreeMap::new();
            for i in 9..b.len().saturating_sub(9) {
                let q = u32_at(b, i)?;
                if (1..1000).contains(&q) && b[i + 4..i + 8] == [0; 4] && matches!(b[i + 8], 2..=4) && b[i - 4..i] != [0; 4] {
                    quests.entry(q).or_insert(b[i + 8]);
                }
            }
            Some(GameCounter::Duties { refreshes, done, quests })
        }
        (0x01 | 0x03, 0x8c) => {
            let whole = op == 0x01;
            let (shop, mut pos) = if whole {
                let (shop, len) = varint(b, 2)?;
                (shop as u32, 2 + len)
            } else {
                (u32_at(b, 2)?, 6)
            };
            let n = *b.get(pos)? as usize;
            pos += 1;
            if pos + 8 * n > b.len() {
                return None;
            }
            let items = (0..n).map(|i| (u32_at(b, pos + 8 * i).unwrap(), u32_at(b, pos + 8 * i + 4).unwrap())).collect();
            Some(GameCounter::Shop { shop, items, whole })
        }
        (0x3b, 0xe3) => {
            let count = *b.first()? as usize;
            if 1 + 21 * count > b.len() {
                return None;
            }
            let list = (0..count)
                .map(|i| {
                    let at = 1 + 21 * i;
                    (u32_at(b, at).unwrap(), u64_at(b, at + 5).unwrap(), u64_at(b, at + 13).unwrap())
                })
                .collect();
            Some(GameCounter::Benefits(list))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(op: u8, family: u8, body: &[u8]) -> Vec<u8> {
        let mut f = vec![(body.len() + 6) as u8, op, family];
        f.extend_from_slice(body);
        f
    }

    #[test]
    fn tickets_keep_a_left_out_value_in_its_place() {
        // Nightmare (id 4): counts 0x04|0x08 = [9, 2]; Odyle Energy: 0x08 alone = [0, 1395].
        let mut b = vec![2];
        b.push(0x0c);
        b.extend(4u32.to_le_bytes());
        b.extend([9, 2]);
        b.push(0x08);
        b.extend(60_000_001u32.to_le_bytes());
        b.extend([0xf3, 0x0a]); // 1395
        let got = decode(&frame(0x0b, 0x61, &b)).unwrap();
        assert_eq!(
            got,
            GameCounter::Tickets(vec![
                (4, Ticket { ms: vec![], n: vec![9, 2] }),
                (60_000_001, Ticket { ms: vec![], n: vec![0, 1395] }),
            ])
        );
        assert!(got.is_list());
    }

    #[test]
    fn one_ticket_changing_and_a_timed_one() {
        let mut b = vec![0, 0x02];
        b.extend(3u32.to_le_bytes());
        b.extend(7_200_000u64.to_le_bytes());
        b.push(3);
        assert_eq!(decode(&frame(0x0c, 0x61, &b)), Some(GameCounter::Ticket(3, Ticket { ms: vec![0, 7_200_000], n: vec![] })));
    }

    #[test]
    fn only_weekly_missions_are_kept() {
        let mut b = vec![2];
        for key in [230_211_000u32, 120_000_000] {
            b.extend(key.to_le_bytes());
            b.extend(7u32.to_le_bytes());
            b.extend(0u64.to_le_bytes());
            b.push(1);
        }
        assert_eq!(decode(&frame(0x83, 0x56, &b)), Some(GameCounter::Missions(vec![(230_211_000, 7, 1)])));
    }

    #[test]
    fn pvp_records_and_shop_counts() {
        let mut b = vec![1, 2];
        b.extend(1500u32.to_le_bytes());
        b.extend([0, 0, 0, 0, 12, 5, 0, 0, 3]);
        assert_eq!(decode(&frame(0x2a, 0xe3, &b)), Some(GameCounter::Pvp(vec![(2, 1500, 12, 5)])));

        let mut s = vec![0, 6];
        s.extend(16_539u32.to_le_bytes());
        s.push(1);
        s.extend(111u32.to_le_bytes());
        s.extend(4u32.to_le_bytes());
        assert_eq!(
            decode(&frame(0x03, 0x8c, &s)),
            Some(GameCounter::Shop { shop: 16_539, items: vec![(111, 4)], whole: false })
        );
    }

    #[test]
    fn other_messages_are_not_counters() {
        assert_eq!(decode(&frame(0x0b, 0x62, &[1, 0])), None);
        assert_eq!(decode(&frame(0x84, 0x56, &[1, 2])), None);
    }
}
