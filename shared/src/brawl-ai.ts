/**
 * D69 Bumper Brawl AI. In an arena there is no racing line: each AI picks a rival (the nearest, and it likes one on
 * its last life), drives round the ring the short way to it, then aims straight at it. It fires orbs and discs when
 * the rival is in line, drops oil on a chaser, saves a turbo to ram with (a boosted ram steals a life) and raises a
 * shield when something is incoming. Difficulty sets how sharp its aim is and how quickly it switches targets.
 */
import { clamp, wrapA } from './constants';
import { posOnTrack } from './track';
import { aiMove } from './moves';
import type { GameState, Kart } from './game';

const tmp = { x: 0, y: 0, z: 0 };

export function brawlAiInput(s: GameState, k: Kart, dt: number): void {
  const T = s.track,
    N = T.N,
    inp = k.input,
    skill = clamp(k.aiCfg.skill, 0.5, 1.1);
  if (k.itemWait > -20) k.itemWait -= dt;
  k.aiRe -= dt;
  let tgt = k.aiTgt >= 0 ? s.karts[k.aiTgt] : undefined;
  // D78: two karts aiming at each other can lock nose to nose at walking pace; after a moment, back off and swing
  // away, then go for someone else
  if (k.aiStall < 0) {
    k.aiStall = Math.min(0, k.aiStall + dt);
    inp.throttle = true;
    inp.brake = false;
    inp.drift = false;
    // away down the ring, back to the middle of the floor (clear of the walls)
    const T0 = s.track,
      way = Math.sin(k.h) * T0.TX[k.idx]! + Math.cos(k.h) * T0.TZ[k.idx]! >= 0 ? 1 : -1;
    posOnTrack(T0, k.idx + (way * 18) / T0.DS, 0, tmp);
    inp.steer = clamp(-wrapA(Math.atan2(tmp.x - k.x, tmp.z - k.z) - k.h) * 2.4, -1, 1);
    return;
  }
  const locked = !!tgt && !tgt.out && Math.hypot(tgt.x - k.x, tgt.z - k.z) < 10 && Math.abs(k.sp) < 9;
  k.aiStall = locked ? k.aiStall + dt : Math.max(0, k.aiStall - dt);
  const stuckOn = k.aiStall > 1.4 ? k.aiTgt : -1;
  if (stuckOn >= 0) {
    k.aiStall = -0.9;
    k.aiRe = 0;
  }
  if (!tgt || tgt.out || tgt === k || k.aiRe <= 0) {
    let best = 1e9;
    tgt = undefined;
    for (const c of s.karts) {
      if (c === k || c.out || c.id === stuckOn) continue;
      const d = Math.hypot(c.x - k.x, c.z - k.z) * (c.lives <= 1 ? 0.7 : 1);
      if (d < best) {
        best = d;
        tgt = c;
      }
    }
    k.aiTgt = tgt ? tgt.id : -1;
    k.aiRe = 1 + (1.1 - skill) * 2;
  }
  inp.throttle = true;
  inp.brake = false;
  inp.drift = false;
  if (!tgt) {
    inp.steer = 0;
    return;
  }

  const fx = Math.sin(k.h),
    fz = Math.cos(k.h);
  // which way round the ring this kart is driving, and the short way to the target
  const dirMove = fx * T.TX[k.idx]! + fz * T.TZ[k.idx]! >= 0 ? 1 : -1;
  let dp = (tgt.idx - k.idx + N) % N;
  if (dp > N / 2) dp -= N;
  const ringDist = Math.abs(dp) * T.DS;
  const dx = tgt.x - k.x,
    dz = tgt.z - k.z,
    dist = Math.hypot(dx, dz);
  let ax: number, az: number;
  if (ringDist < 45) {
    // close on the same stretch: aim at where the target will be
    const lead = clamp(dist / 60, 0.1, 0.6);
    ax = tgt.x + tgt.vx * lead;
    az = tgt.z + tgt.vz * lead;
  } else {
    // round the ring the short way, drifting over to the target's side of the road
    const way = dp >= 0 ? 1 : -1;
    const lat = clamp(tgt.lat, -(T.HW[k.idx]! - 3), T.HW[k.idx]! - 3);
    posOnTrack(T, k.idx + (way * 16) / T.DS, lat, tmp);
    ax = tmp.x;
    az = tmp.z;
  }
  // keep off the walls: heading for one, aim back towards the middle of the road
  const vl = k.vx * T.RX[k.idx]! + k.vz * T.RZ[k.idx]!;
  if (Math.abs(k.lat) > T.WALLD[k.idx]! - 7 && vl * k.lat > 0) {
    posOnTrack(T, k.idx + (dirMove * 12) / T.DS, 0, tmp);
    ax = tmp.x;
    az = tmp.z;
  }
  // a little aim error on the easier AIs
  const wobble = Math.sin(s.time * 1.3 + k.aiCfg.ph) * 0.12 * (1.1 - skill);
  const err = wrapA(Math.atan2(ax - k.x, az - k.z) - k.h) + wobble;
  inp.steer = clamp(-err * 2.4, -1, 1);
  // turning round: lift (and brake) so the kart turns tighter
  if (Math.abs(err) > 2.3 && k.sp > 24) inp.brake = true;

  // D74: the signature move
  if (s.moves && aiMove(s, k)) inp.move = true;

  // items
  const toTgt = wrapA(Math.atan2(dx, dz) - k.h),
    ahead = Math.abs(toTgt) < Math.PI / 2;
  if (k.item && k.roll <= 0 && k.itemWait <= 0) {
    let use = false,
      back = false;
    const chaser = s.karts.some(
      (c) =>
        c !== k &&
        !c.out &&
        Math.hypot(c.x - k.x, c.z - k.z) < 18 &&
        Math.abs(wrapA(Math.atan2(c.x - k.x, c.z - k.z) - k.h)) > 2.2,
    );
    switch (k.item) {
      case 'orb':
        if (dist < 70) {
          use = true;
          back = !ahead;
        }
        break;
      case 'bolt':
        if (ahead && Math.abs(toTgt) < 0.22 && dist < 45) use = true;
        else if (!ahead && dist < 14) {
          use = true;
          back = true;
        }
        break;
      case 'oil':
        use = chaser;
        break;
      case 'turbo':
      case 'turbo3':
        // ram: boost straight at a close rival
        use = ahead && Math.abs(toTgt) < 0.3 && dist < 30;
        break;
      case 'shield':
        use = k.threat > 0 || k.itemWait < -4;
        break;
      default:
        use = true;
    }
    if (use) {
      inp.item = true;
      inp.itemBack = back;
    }
  }
}
