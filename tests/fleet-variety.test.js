import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FLEET, aircraftType } from '../src/fleet.js';
import { FlightController, FlightAudio, fighterSound, helicopterSound, propellerSound } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { createAircraft, createCockpit } from '../src/aircraft.js';
import { disposeObject } from '../src/helicopter.js';
import { groundHeight } from '../src/world.js';
import { AIRPORTS, RUNWAY_NEEDS, suitability, airportById, runwayDirection } from '../src/airports.js';
import { runwayPoint, runwayCoordinates } from '../src/airfield.js';
import { LandingMission, landingProfile, TOUCHDOWN_ZONE } from '../src/landing-mission.js';
import { missionAvailability } from '../src/airport-selection.js';

// The fleet-variety addition: four original types beside the seventeen that came before them.
const NEW = ['racer', 'pushpull', 'tandem', 'interceptor'];
const FIXED_WING = NEW.filter(id => !FLEET[id].flight.rotorcraft);
const kt = v => v * 1.94384;
const flying = (id, height = groundHeight) => new FlightController(height, id);
function run(flight, seconds, controls = {}, rate = 120) {
  for (let i = 0; i < Math.round(seconds * rate); i++) flight.update(1 / rate, controls);
  return flight.state;
}
/** Shaped keyboard input through the real time-based control layer. */
function shaped(flight, seconds, controls, rate = 60) {
  const input = new FlightInputs(); input.set(controls, 0);
  for (let frame = 1; frame <= seconds * rate; frame++) input.advance(frame / rate, (dt, c) => flight.update(dt, c));
  return flight.state;
}
/** Full-power departure with 15° flaps where fitted, rotating near the type's own speed; returns the ground roll. */
function depart(flight, field = null) {
  const s = flight.state, type = flight.type, input = new FlightInputs();
  if (!type.noFlaps) flight.cycleFlaps();
  for (let frame = 1; frame < 90 * 60 && s.grounded && !s.crashed; frame++) {
    input.set({ throttle: 1, pitch: s.speed > type.flight.rotateSpeed - 3 ? 1 : 0 }, (frame - 1) / 60);
    input.advance(frame / 60, (dt, c) => flight.update(dt, c));
    if (field && s.grounded) assert.ok(runwayCoordinates(s.position, field).along < field.runwayLength, `${type.id}: ran off the end`);
  }
  return s.distance;
}
/** The landing tests' deterministic feedback pilot: ordinary rate inputs from the mission's own start. */
function landingPilot(flight, mission) {
  const s = flight.state, p = mission.profile, input = new FlightInputs(0), field = mission.field;
  let touchdownAlong = null, stopAlong = null;
  for (let frame = 1; frame < 90 * 60 && mission.active; frame++) {
    const height = s.position.y - field.elevation - p.clearance;
    const sink = height < 8 ? Math.min(1.8, p.maxSink * 0.65) : p.speed * p.slope;
    const idleSink = p.helicopter ? 0 : Math.max(0, 0.32 - s.spool) * (flight.type.flight.idleSink ?? 6);
    const desiredPitch = p.helicopter ? 0 : Math.asin((-sink + idleSink) / Math.max(s.speed, 1));
    input.set({ pitch: (desiredPitch - s.pitch) * 4, throttle: s.grounded || (p.helicopter && s.throttle > p.throttle - 0.03) ? -1 : 0 }, (frame - 1) / 60);
    input.advance(frame / 60, (dt, c) => { if (!mission.active) return; flight.update(dt, c); mission.update(dt, s); });
    if (s.grounded && touchdownAlong === null) touchdownAlong = runwayCoordinates(s.position, field).along;
    if (s.grounded) stopAlong = runwayCoordinates(s.position, field).along;
  }
  return { touchdownAlong, rollout: stopAlong - touchdownAlong };
}

test('four new aircraft complete the fleet with unique identities, complete data and truthful text', () => {
  assert.equal(Object.keys(FLEET).length, 21);
  for (const id of NEW) assert.equal(aircraftType(id).id, id);
  for (const key of ['id', 'name', 'registration', 'badge']) assert.equal(new Set(Object.values(FLEET).map(t => t[key])).size, 21, key);
  const jetKeys = Object.keys(FLEET.jet.flight).sort().join();
  for (const id of FIXED_WING) {
    const t = FLEET[id], f = t.flight;
    assert.equal(Object.keys(f).sort().join(), jetKeys, id);
    assert.ok(t.summary.startsWith(t.name));
    // Help and hints quote the tuned rotate, approach and touchdown limits.
    const rotate = Math.round(kt(f.rotateSpeed - (t.noFlaps ? 0 : f.flapStallGain)));
    assert.match(t.help, new RegExp(`${rotate} kt`), id); assert.match(t.runwayHint, new RegExp(`${rotate} kt`), id);
    assert.match(t.help, new RegExp(`${Math.round(kt(t.landing.speed))} kt`), id);
    assert.match(t.help, new RegExp(`${Math.round(kt(f.maxTouchdownSpeed))} kt`), id);
    // Cruise is the exact steady state of the shared model in the configuration the aircraft starts in.
    assert.ok(Math.abs(f.idleSpeed + f.cruiseThrottle * f.thrustSpeed - (t.fixedGear ? f.gearDrag : 0) - f.cruiseSpeed) < 1e-9, id);
    assert.match(`${t.help} ${t.runwayHint}`, t.fixedGear ? /fixed/i : /gear/i);
  }
  assert.equal(FLEET.racer.fixedGear, undefined); assert.equal(FLEET.interceptor.fixedGear, undefined);
  assert.equal(FLEET.pushpull.fixedGear, true);
  // The heavy helicopter is described with wheels and collective only.
  const tandem = FLEET.tandem, text = [tandem.help, tandem.runwayHint, tandem.choice, tandem.summary].join(' ');
  assert.equal(tandem.landingGear, 'wheels'); assert.equal(tandem.rotor.tandem, true); assert.equal(tandem.rotor.tailRate, undefined);
  assert.match(text, /wheel/i); assert.match(text, /collective/i);
  assert.match(text, /no tail rotor/i); assert.doesNotMatch(text.replace(/no tail rotor/gi, ''), /skid|tail rotor|runway 36|flaps for|lower your gear|hold S near/i);
  assert.match(tandem.help, new RegExp(`${Math.round(tandem.flight.hoverCollective * 100)}% collective`));
  // The Explore roster counts the fleet instead of quoting a number.
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /\$\{Object\.keys\(FLEET\)\.length\} to fly/); assert.doesNotMatch(main, /\b(17|21) to fly/);
});

test('each type is tuned distinctly from the aircraft it could be mistaken for', () => {
  const r = FLEET.racer.flight, silex = FLEET.aerobatic.flight, trainer = FLEET.trainer.flight;
  // The racer is fast and crisp but bounded; the Silex is the free-attitude aerobat on fixed gear.
  assert.equal(r.aerobatic, false); assert.ok(r.pitchLimits && r.bankLimit); assert.equal(silex.aerobatic, true);
  assert.ok(r.cruiseSpeed > silex.cruiseSpeed * 1.4 && r.cruiseSpeed > FLEET.canard.flight.cruiseSpeed);
  assert.ok(r.rollRate > trainer.rollRate * 2 && r.rollRate < silex.rollRate);
  // The push-pull twin is a steady tourer: gentler than the Neris canard and slower to bank than the Sarine C24.
  const p = FLEET.pushpull.flight;
  assert.ok(p.rollRate < FLEET.canard.flight.rollRate && p.rollRate < FLEET.commuter.flight.rollRate);
  assert.ok(p.cruiseSpeed < FLEET.canard.flight.cruiseSpeed && p.cruiseSpeed < FLEET.commuter.flight.cruiseSpeed);
  assert.ok(!FLEET.pushpull.noFlaps && FLEET.canard.noFlaps);
  // The tandem is the most deliberate rotorcraft on every axis.
  const t = FLEET.tandem.flight, h8 = FLEET.transport.flight;
  for (const key of ['pitchRate', 'pitchResponse', 'rollRate', 'rollResponse', 'yawRate', 'yawResponse', 'levelRate', 'collectiveResponse', 'rotorSpinUp', 'rotorSpinDown', 'throttleRate', 'bankLimit'])
    assert.ok(t[key] < h8[key], key);
  assert.ok(t.hoverCollective > h8.hoverCollective && t.groundClearance > h8.groundClearance && t.footprint[1] > h8.footprint[1]);
  // The interceptor keeps the fighter's free attitude, with a heavier twin's restrained burners.
  const i = FLEET.interceptor.flight, f7 = FLEET.fighter.flight;
  assert.equal(i.aerobatic, true); assert.equal(i.pitchLimits, null); assert.equal(i.bankLimit, null);
  assert.ok(i.afterburnerSpeed < f7.afterburnerSpeed && i.afterburnerFrom > f7.afterburnerFrom);
  assert.ok(i.rollRate < f7.rollRate && i.maxAcceleration < f7.maxAcceleration);
});

for (const id of FIXED_WING) {
  const type = FLEET[id], f = type.flight;
  test(`${id}: fresh airborne start holds cruise, departs a runway with normal inputs, stalls and recovers`, () => {
    const flight = flying('fighter', () => 78); run(flight, 1, { roll: 1 });
    flight.setAircraft(id); const s = flight.state;
    assert.equal(s.aircraft, id); assert.equal(s.speed, f.cruiseSpeed); assert.equal(s.gearDown, !!type.fixedGear);
    run(flight, 20); assert.equal(s.crashed, false); assert.ok(Math.abs(s.speed - f.cruiseSpeed) < 0.2);
    const p = runwayPoint(100); flight.runwayStart(p.x, 78 + type.groundClearance, p.z);
    assert.equal(s.grounded, true); assert.equal(s.gearDown, true);
    const roll = depart(flight);
    assert.equal(s.grounded, false); assert.ok(roll * 1.5 <= RUNWAY_NEEDS[id].length, `${id}: ${roll} m`);
    run(flight, 6, { throttle: 1 }); assert.equal(s.crashed, false); assert.ok(s.position.y > 100);
    // Throttle back in level flight: it stalls just below its own stall speed, then recovers with power.
    const high = flying(id, () => 0), h = high.state;
    for (let i = 0; i < 60 * 120 && !h.stalled; i++) high.update(1 / 120, { throttle: -1 });
    assert.equal(h.stalled, true); assert.ok(h.speed < f.stallSpeed && h.speed > f.stallSpeed - 0.3);
    for (let i = 0; i < 40 * 120 && h.stalled; i++) high.update(1 / 120, { throttle: 1 });
    assert.equal(h.stalled, false); assert.equal(h.crashed, false);
  });
}

test('Rava R6: crisp but bounded rolls, retractable gear with the gear warning', () => {
  const flight = flying('racer', () => 0), s = flight.state; s.position.y = 1500;
  shaped(flight, 4, { roll: 1 });
  assert.ok(Math.abs(s.bank - FLEET.racer.flight.bankLimit) < 1e-9, 'bank stops at its limit');
  const trainer = flying('trainer', () => 0); trainer.state.position.y = 1500; shaped(trainer, 0.8, { roll: 1 });
  const racer = flying('racer', () => 0); racer.state.position.y = 1500; shaped(racer, 0.8, { roll: 1 });
  assert.ok(racer.state.bank > trainer.state.bank * 1.8, 'answers much faster than the trainer');
  run(flight, 8); assert.ok(Math.abs(s.bank) < FLEET.racer.flight.bankLimit * 0.6, 'released wings ease back');
  const low = flying('racer'); low.state.position.set(900, 100, -1800); low.state.throttle = 0.1;
  assert.equal(low.state.gearDown, false); assert.equal(low.gearWarning, true);
  low.toggleGear(); assert.equal(low.state.gearDown, true); assert.equal(low.gearWarning, false);
  assert.equal(low.cycleFlaps(), 1);
});

test('Cervin P6: fixed gear, flaps and a steady, self-levelling tourer', () => {
  const flight = flying('pushpull', () => 0), s = flight.state; s.position.y = 1500;
  assert.equal(flight.toggleGear(), true); assert.equal(flight.gearWarning, false); assert.equal(flight.cycleFlaps(), 1);
  flight.cycleFlaps(); flight.cycleFlaps();
  shaped(flight, 1.2, { roll: 1 }); const banked = s.bank;
  assert.ok(banked > 0.2 && banked < FLEET.pushpull.flight.bankLimit);
  run(flight, 12); assert.ok(Math.abs(s.bank) < banked * 0.25, `bank ${s.bank}`);
  assert.equal(s.crashed, false); assert.equal(s.stalled, false);
});

test('Lodra H20: true hover, slow collective, ground lift-off and a hover hold with no tail rotor', () => {
  const f = FLEET.tandem.flight, flight = flying('tandem', () => 78), s = flight.state;
  assert.equal(s.throttle, f.hoverCollective); assert.equal(s.gearDown, true);
  const y = s.position.y; run(flight, 10); assert.ok(Math.abs(s.position.y - y) < 0.01, 'hovers at its own collective');
  // A collective step climbs more slowly than the Sorna H8's.
  const climb = id => { const c = flying(id, () => 78); c.state.throttle = FLEET[id].flight.hoverCollective + 0.1; run(c, 0.6); return c.state.verticalSpeed; };
  assert.ok(climb('tandem') > 0 && climb('tandem') < climb('transport'));
  // From the ground both rotors spin up first; raising collective then lifts it off.
  const p = runwayPoint(220); flight.runwayStart(p.x, 0, p.z);
  assert.equal(s.grounded, true); assert.equal(s.rotorSpeed, 0); assert.equal(s.position.y, 78 + f.groundClearance);
  shaped(flight, 3, { throttle: 1 }); assert.equal(s.grounded, true, 'needs time to spin up');
  for (let i = 0; i < 25 * 120 && s.grounded; i++) flight.update(1 / 120, { throttle: s.throttle < 0.8 ? 1 : 0 });
  assert.equal(s.grounded, false); assert.ok(s.rotorSpeed > 0.9);
  run(flight, 3); flight.toggleAutopilot(); assert.equal(s.autopilot, true);
  const held = s.position.clone(); run(flight, 15);
  assert.ok(s.position.distanceTo(held) < 3, 'hover hold'); assert.equal(s.crashed, false);
  assert.equal(flight.toggleGear(), true); assert.equal(flight.cycleFlaps(), 0); assert.equal(flight.gearWarning, false);
});

test('Taris F12: unrestricted loops, full rolls and inverted flight with restrained afterburners', () => {
  for (const axis of ['pitch', 'roll']) {
    const flight = flying('interceptor', () => 0), input = new FlightInputs(); flight.state.position.y = 3000; let turned = 0;
    input.set({ [axis]: 1, throttle: 1 }, 0);
    for (let frame = 1; frame <= 17 * 60; frame++) input.advance(frame / 60, (dt, c) => { flight.update(dt, c); turned += flight.state.bodyRates[axis] * dt; });
    // At least one and a half continuous loops or rolls, never clamped.
    assert.ok(turned > Math.PI * 3, `${axis}: ${turned}`); assert.equal(flight.state.crashed, false);
    assert.ok(Math.abs(flight.state.quaternion.length() - 1) < 1e-10);
  }
  // Half a roll, then release: it stays inverted, holding the attitude rather than self-levelling.
  const flight = flying('interceptor', () => 0), s = flight.state; s.position.y = 3000;
  const rollTime = Math.PI / FLEET.interceptor.flight.rollRate;
  for (let i = 0; i < 1200 && Math.abs(s.bank) < 3.05; i++) flight.update(1 / 120, { roll: 1 });
  run(flight, 1.5); assert.ok(Math.abs(s.bank) > 2.7, `bank ${s.bank}`); assert.ok(rollTime < 1.5);
  flight.toggleAutopilot(); run(flight, 6); assert.ok(Math.abs(s.bank) < 0.1, 'Space recovers to level');
  // Afterburner only at the very top of the lever; it adds less than the Arolla's.
  const burner = flying('interceptor', () => 0); burner.state.position.y = 3000;
  run(burner, 4, { throttle: 1 }); assert.equal(burner.state.afterburner, true);
  burner.state.throttle = 0.9; run(burner, 1); assert.equal(burner.state.afterburner, false);
  const level = id => { const c = flying(id, () => 0); c.state.position.y = 3000; c.state.throttle = 1; c.state.spool = 1; c.toggleAutopilot(); run(c, 60); return c.state.speed; };
  assert.ok(level('interceptor') < level('fighter'));
});

test('suitability and runway or approach starts at real fields, with measured rolls inside each need', () => {
  const ratings = id => Object.fromEntries(AIRPORTS.map(a => [a.id, suitability(a, id).rating]));
  assert.deepEqual(Object.keys(RUNWAY_NEEDS).sort(), Object.keys(FLEET).sort());
  assert.ok(Object.values(ratings('tandem')).every(r => r === 'recommended'));
  assert.equal(ratings('racer')['verdance-meadow'], 'unsuitable'); assert.match(suitability(airportById('verdance-meadow'), 'racer').reason, /paved/);
  assert.equal(ratings('racer')['brume-col'], 'recommended');
  assert.equal(ratings('pushpull')['verdance-meadow'], 'recommended'); assert.equal(ratings('pushpull')['brume-col'], 'recommended');
  assert.equal(ratings('interceptor')['brume-col'], 'unsuitable'); assert.equal(ratings('interceptor')['verdance-meadow'], 'unsuitable');
  assert.equal(ratings('interceptor')['orvane-regional'], 'recommended'); assert.equal(ratings('interceptor')['alpine-field'], 'suitable');
  assert.equal(missionAvailability(airportById('brume-col'), 'interceptor').available, false);
  for (const [id, airport] of [['racer', 'brume-col'], ['pushpull', 'verdance-meadow'], ['interceptor', 'orvane-regional']]) {
    const a = airportById(airport);
    for (const rw of [a.runway, a.reciprocal]) {
      const field = runwayDirection(a, rw), flight = flying(id), s = flight.state, p = runwayPoint(100, 0, field);
      flight.runwayStart(p.x, groundHeight(p.x, p.z) + FLEET[id].groundClearance, p.z, field.heading);
      depart(flight, field); assert.equal(s.crashed, false, `${id} ${rw}: ${s.crashReason}`);
      const climb = new FlightInputs();
      for (let frame = 1; frame < 40 * 60 && s.position.y < field.elevation + 60 && !s.crashed; frame++) {
        climb.set({ throttle: 1, pitch: s.pitch < 0.12 ? 0.5 : 0 }, (frame - 1) / 60); climb.advance(frame / 60, (dt, c) => flight.update(dt, c));
      }
      assert.equal(s.crashed, false); assert.ok(s.position.y > field.elevation + 60, `${id} ${rw} climbs away`);
      const landing = flying(id), mission = new LandingMission(field); mission.start(landing);
      const { touchdownAlong, rollout } = landingPilot(landing, mission);
      assert.equal(mission.status, 'success', `${id} ${airport} ${rw}: ${JSON.stringify(mission.snapshot())}`);
      assert.ok(touchdownAlong >= TOUCHDOWN_ZONE.start && touchdownAlong <= TOUCHDOWN_ZONE.end, `${id}: ${touchdownAlong}`);
      assert.ok(rollout * 1.5 <= RUNWAY_NEEDS[id].length, `${id}: rollout ${rollout} m`);
    }
  }
  // The tandem lifts off from and lands on the short mountain strip in its precision box.
  const field = runwayDirection(airportById('brume-col'), '29'), mission = new LandingMission(field), heli = flying('tandem');
  mission.start(heli); assert.equal(mission.profile.contact, 'wheels'); assert.equal(mission.profile.throttle, FLEET.tandem.flight.hoverCollective);
  landingPilot(heli, mission); assert.equal(mission.status, 'success', JSON.stringify(mission.snapshot()));
});

test('models, cockpits and sound: the four types build, animate, route audio and dispose when swapped', () => {
  const named = (root, name) => { const out = []; root.traverse(o => { if (o.name === name) out.push(o); }); return out; };
  const resources = root => { const set = new Set(); root.traverse(o => { if (o.geometry) set.add(o.geometry); for (const m of [o.material].flat().filter(Boolean)) { set.add(m); if (m.map) set.add(m.map); } }); return set; };
  const expected = { racer: { propeller: 1 }, pushpull: { propeller: 2 }, tandem: { 'front rotor': 1, 'rear rotor': 1, 'tail rotor': 0 }, interceptor: { exhaust: 2, afterburner: 2, propeller: 0 } };
  let previous = createAircraft('jet'), deck = createCockpit('jet');
  for (const id of [...NEW, 'jet']) {
    // Swapping aircraft disposes everything the previous airframe and cockpit owned.
    const owned = new Set([...resources(previous.group), ...resources(deck)]), released = new Set();
    owned.forEach(r => r.addEventListener('dispose', () => released.add(r)));
    previous.dispose(); disposeObject(deck); assert.equal(released.size, owned.size, `swap to ${id}`);
    previous = createAircraft(id); deck = createCockpit(id);
    assert.match(previous.group.name, new RegExp(FLEET[id].name)); assert.match(deck.name, new RegExp(FLEET[id].name));
    for (const [name, count] of Object.entries(expected[id] ?? {})) assert.equal(named(previous.group, name).length, count, `${id} ${name}`);
    deck.userData.fit?.(390 / 844); deck.userData.fit?.(1600 / 900);
  }
  previous.dispose(); disposeObject(deck);
  // Every propulsor visibly turns: both push-pull props, and the tandem's rotors in opposite directions.
  const pp = createAircraft('pushpull'), props = named(pp.group, 'propeller'), before = props.map(p => p.rotation.z);
  pp.update(0.1, 0.8, { spool: 0.8, gearDown: true, grounded: true, flightTime: 1 });
  props.forEach((p, i) => assert.ok(Math.abs(p.rotation.z - before[i]) > 0.5)); pp.dispose();
  const heli = createAircraft('tandem'), [front] = named(heli.group, 'front rotor'), [rear] = named(heli.group, 'rear rotor');
  heli.update(0.05, 0.66, { rotorSpeed: 1 }); assert.ok(front.rotation.y * rear.rotation.y < 0, 'counter-rotating'); heli.dispose();
  // Sound: pistons on the propeller bus with their own voices, the tandem's doubled blade-pass, the twin on the fighter bus.
  assert.ok(propellerSound('piston', 0.8, 100, FLEET.racer.propVoice).tone > propellerSound('piston', 0.8, 100).tone);
  assert.ok(propellerSound('piston', 0.8, 60, FLEET.pushpull.propVoice).tone < propellerSound('piston', 0.8, 60).tone);
  assert.equal(helicopterSound(1, 0.66, 0, FLEET.tandem.rotor).bladePass, helicopterSound(1, 0.66, 0, { ...FLEET.tandem.rotor, tandem: false }).bladePass * 2);
  const twin = fighterSound(0.95, 200, true, FLEET.interceptor.engineVoice), single = fighterSound(0.95, 200, true);
  assert.ok(twin.whine < single.whine && twin.rumbleGain > single.rumbleGain && twin.burnerGain < single.burnerGain);
  assert.deepEqual(fighterSound(0.95, 200, true, null), single);
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } }), node = () => ({ gain: param() }), voice = () => ({ filter: { frequency: param() }, gain: node() });
  const audio = new FlightAudio(); audio.context = { currentTime: 1 }; audio.enabled = true;
  for (const key of ['master', 'gearHorn', 'propBus', 'jetBus', 'fighterBus', 'helicopterBus', 'wind']) audio[key] = node();
  audio.prop = { tone: { frequency: param() }, pulse: { frequency: param() }, turbine: { frequency: param() }, toneVoice: voice(), turbineVoice: voice(), depth: node(), wash: voice() };
  audio.helicopter = { rotor: { frequency: param() }, pulse: { frequency: param() }, turbine: { frequency: param() }, rotorVoice: voice(), turbineVoice: voice(), chop: voice(), depth: node() };
  audio.fighter = { whine: { frequency: param() }, whineVoice: voice(), roar: voice(), rumble: voice(), burner: voice() };
  const buses = () => ['propBus', 'helicopterBus', 'fighterBus', 'jetBus'].filter(k => audio[k].gain.value === 1);
  for (const [id, bus] of [['racer', 'propBus'], ['pushpull', 'propBus'], ['tandem', 'helicopterBus'], ['interceptor', 'fighterBus']]) {
    const s = { aircraft: id, spool: 0.72, throttle: 0.1, speed: 80, rotorSpeed: 1, afterburner: false, gearDown: false };
    audio.update(s, true); assert.deepEqual(buses(), [bus], id); assert.ok(audio.master.gain.value > 0, id);
    assert.equal(audio.gearHorn.gain.value, FLEET[id].fixedGear || FLEET[id].flight.rotorcraft ? 0 : 0.12, id);
    audio.update({ ...s, crashed: true }, true); assert.equal(audio.master.gain.value, 0);
  }
  audio.update({ aircraft: 'interceptor', spool: 1, speed: 200, afterburner: true });
  assert.equal(audio.fighter.whine.frequency.value, fighterSound(1, 200, true, FLEET.interceptor.engineVoice).whine);
  audio.update({ aircraft: 'tandem', rotorSpeed: 1, spool: 0.66, speed: 0 });
  assert.equal(audio.helicopter.pulse.frequency.value, helicopterSound(1, 0.66, 0, FLEET.tandem.rotor).bladePass);
});

test('landing briefs: fixed-wing configuration for the three aeroplanes, wheels and collective for the tandem', () => {
  for (const id of FIXED_WING) {
    const p = landingProfile(FLEET[id]);
    assert.equal(p.helicopter, false); assert.equal(p.flaps, 2); assert.equal(p.contact, 'gear');
    assert.ok(p.throttle > 0.1 && p.throttle < 0.6, `${id}: ${p.throttle}`);
    assert.ok(p.speedMin > FLEET[id].flight.stallSpeed - 2 * FLEET[id].flight.flapStallGain, id);
  }
  const p = landingProfile(FLEET.tandem);
  assert.equal(p.helicopter, true); assert.equal(p.contact, 'wheels'); assert.equal(p.flaps, 0);
  assert.equal(p.settlePower, 0.65); assert.equal(p.clearance, FLEET.tandem.flight.groundClearance);
});
