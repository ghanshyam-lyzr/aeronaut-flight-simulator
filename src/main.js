import './style.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/barlow-condensed/400.css';
import '@fontsource/barlow-condensed/500.css';
import * as THREE from 'three';
import { createIcons, Plane, SlidersHorizontal, Maximize, Minimize, VolumeX, Volume2, MapPin, ArrowUpRight, Sun, CloudSun, Cloud, ChevronDown, ChevronUp, ChevronsUpDown, Navigation, Video, Camera, Map, Scan, Minus, Plus, CircleDot, RotateCcw, Pause, Play, Keyboard, Move, TriangleAlert, X, Check, Mountain, Compass, Wind, Menu, Maximize2 } from 'lucide';
import { createWorld } from './world.js';
import { createAircraft, createCockpit } from './aircraft.js';
import { loadAircraftTheme } from './aircraft-theme-storage.js';
import { createAircraftThemeEditor } from './aircraft-theme-editor.js';
import { FlightController, FlightAudio, FollowFrame, hasPitchTrim, hasHeadingSelect } from './flight.js';
import { FLEET, aircraftType } from './fleet.js';
import { FlightInputs } from './controls.js';
import { loadFlights, saveFlights as storeFlights, recordFlight, flightTotals, formatFlightDate } from './flight-log.js';
import { LandingHistory } from './landing-history.js';
import { landingHistoryMarkup, mountLandingHistory } from './landing-history-ui.js';
import { loadSettings, saveSettings as storeSettings, resetSettings, CUSTOMIZATION_KEYS, anyDisplayHidden, toggleDisplay, flightPathShown, RESPONSE, CHASE_DISTANCE, VOLUME, percent } from './settings.js';
import { disposeObject } from './helicopter.js';
import { LandingMission, landingProfile } from './landing-mission.js';
import { runwayPoint } from './airfield.js';
import { AIRPORTS, suitability } from './airports.js';
import { AirportSelection, resolveAirport, missionAvailability, describeField, headingDegrees } from './airport-selection.js';
import { region } from './regions.js';
import { createLandingGuidance } from './landing-guidance.js';
import { createGlideLights } from './glide-lights.js';
import { CheckpointCourse, courseAvailability, formatCourseTime, RECOMMENDED_AIRCRAFT } from './checkpoint-course.js';
import { Activities } from './activities.js';
import { CrosswindPractice, PRACTICE, practiceAvailability, practiceBrief, practiceCue, crosswindAdvice } from './crosswind-practice.js';
import { StallRecovery, RECOVERY, recoveryAvailability } from './stall-recovery.js';
import { createCourseGates } from './course-gates.js';
import { FlightPathMarker, groundVelocity, groundTrack } from './flight-path.js';
import { WIND_PRESETS, windText, sampleText, KNOT } from './wind.js';
import { adviseRunway, componentText, windReadout, readoutField, applyAdvice } from './runway-wind.js';
import { AirspeedMonitor, airspeedEnvelope, tapeLayout, AIRSPEED_LABELS, OVERSPEED_NOTICE } from './airspeed-envelope.js';
import { TerrainAlert, terrainNotice } from './terrain-alert.js';
import { AltitudeReminder, altitudeReminderNotice } from './altitude-reminder.js';
import { createAltitudeReminderUI } from './altitude-reminder-ui.js';
import { TouchdownDetector, touchdownResponse, touchdownOutputs, impulseShape } from './touchdown.js';
import { NavigationMap } from './nav-map.js';
import { navigationDestination, navigationReadout, bearingDistance, degrees, formatNM, zoomFrom, nearestZoom, FRAMINGS, FRAMING_LABELS, ZOOM_SPANS } from './navigation.js';

// Initialize before creating terrain, maps or flight controllers. A static host
// with missing/blocked WASM can still fly using the behavioral reference.
import { initNumerics, numerics } from './wasm/runtime.js';
try { await initNumerics(); }
catch (error) { console.warn('Using JavaScript flight engine:', error); }

const icons = {Plane,SlidersHorizontal,Maximize,Minimize,VolumeX,Volume2,MapPin,ArrowUpRight,Sun,CloudSun,Cloud,ChevronDown,ChevronUp,ChevronsUpDown,Navigation,Video,Camera,Map,Scan,Minus,Plus,CircleDot,RotateCcw,Pause,Play,Keyboard,Move,TriangleAlert,X,Check,Mountain,Compass,Wind,Menu,Maximize2};
const refreshIcons = () => createIcons({icons,attrs:{'stroke-width':1.6}});
refreshIcons();
const $ = id => document.getElementById(id);
const worldContainer = $('world');
// Validated, migrated preferences (src/settings.js); corrupt or blocked storage falls back to defaults.
const settings = loadSettings();
let miniMap=null,chartMap=null; // Navigation maps, made once the world exists (below).
const saveSettings = () => storeSettings(settings);
// The selected field and runway (src/airport-selection.js), saved as a stable id; old or invalid settings mean Alpine Field 36.
const selection = new AirportSelection(settings.airport, settings.runway);
settings.airport = selection.id; settings.runway = selection.runway;
let savedFlights = loadFlights();
let renderer;
try {
 renderer = new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance',preserveDrawingBuffer:true});
} catch {
 $('loading').innerHTML='<h1>WebGL is needed to fly.</h1><p>Enable hardware acceleration in your browser, then reload.</p>';
 throw new Error('WebGL is unavailable');
}
renderer.setSize(worldContainer.clientWidth,worldContainer.clientHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio,settings.quality==='high'?1.75:settings.quality==='medium'?1.2:0.85));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = settings.quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
worldContainer.appendChild(renderer.domElement);
const scene = new THREE.Scene();
// A metre still clears the cockpit, and gives the distant lake/shore ten times
// the depth precision of a 10 cm near plane, reducing shoreline depth fighting.
const camera = new THREE.PerspectiveCamera(54,worldContainer.clientWidth/worldContainer.clientHeight,1,65000);
scene.add(camera);
const world = createWorld(scene,renderer);
let aircraft = createAircraft(settings.aircraft);
aircraft.paint.apply(loadAircraftTheme(settings.aircraft));
scene.add(aircraft.group);world.reflectSky(aircraft.group);
const flight = new FlightController(world.heightAt, settings.aircraft);
const altitudeReminder = new AltitudeReminder();
let altitudeControls = null;
// Close first: blurring an edited field can commit it. That commit must happen before the fresh flight forgets it.
function resetAltitudeReminder(){altitudeControls?.close();altitudeReminder.reset();altitudeControls?.refresh();}
// Wind (src/wind.js) is its own choice, calm unless the pilot picked one; it carries over resets and aircraft changes.
flight.setWind(settings.wind,{immediate:true});
const landing = new LandingMission(selection.field);
// Scored activities never run together; the wind owner ends before the next one starts (src/activities.js).
const landingHistory = new LandingHistory({context:()=>({weather:settings.weather})});
const course = new CheckpointCourse(), practice = new CrosswindPractice(landing), recovery = new StallRecovery(), activities = new Activities(landing, course, practice, recovery, landingHistory);
const signalProbe=document.createElement('span');signalProbe.style.color='var(--accent)';document.body.appendChild(signalProbe);
const signalColor=getComputedStyle(signalProbe).color;signalProbe.remove();
let landingCues = createLandingGuidance(scene,landing.field,signalColor);
// Cues belong to one field and runway: a mission elsewhere frees them and builds fresh ones.
function setMissionCues(field){if(landingCues.field.id===field.id&&landingCues.field.runway===field.runway)return;landingCues.dispose();landingCues=createLandingGuidance(scene,field,signalColor);}
let missionResultShown=false;
const courseGates=createCourseGates(scene,course.course,world.heightAt,signalColor);
// Glide-path lights follow the mission's runway while one is underway, otherwise the selected one; they read the aircraft, never the camera.
const glideLights=createGlideLights(scene);
function updateGlideLights(){const s=flight.state;glideLights.setField(landing.status==='idle'?selection.field:landing.field);glideLights.update(s.position,landingProfile(flight.type),{grounded:s.grounded,crashed:s.crashed||activities.finished});}
flight.toggleAutopilot();
const audio = new FlightAudio();
// Touchdown feedback (src/touchdown.js): each new wheel or skid contact once, as a short sound and a camera-local settle.
// Read-only on the flight; resets, retries, runway starts and aircraft changes resynchronise it without an event.
const touchdown=new TouchdownDetector(flight.state),reducedMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
let settle=null,lastTouchdown=null;const settleOffset=new THREE.Vector3();
function resetTouchdown(){touchdown.sync(flight.state);settle=null;lastTouchdown=null;audio.stopTouchdown();}
function updateTouchdown(){
 if(activities.finished){touchdown.sync(flight.state);settle=null;audio.stopTouchdown();return;}
 const record=touchdown.update(flight.state);if(!record)return;
 const r=touchdownResponse(record,flight.type),out=touchdownOutputs({paused,dialogOpen:dialog.open,hidden:document.hidden,soundOn:audio.enabled,audioRunning:audio.context?.state==='running',reducedMotion:!!reducedMotion?.matches});
 const sound=out.sound&&audio.playTouchdown(r.sound);
 settle=out.motion?{start:frameTime,duration:r.impulse.duration,cockpit:r.impulse.cockpit,outside:r.impulse.outside}:null;
 lastTouchdown={kind:r.kind,contact:r.contact,level:r.level,severity:r.severity,sink:r.sink,speed:r.speed,gain:sound?audio.touchdownVoice?.gain??r.sound.gain:0,impulse:out.motion?{...r.impulse}:null,sound,motion:out.motion,time:record.time,count:(lastTouchdown?.count??0)+1};
}
let paused=false, view=settings.camera, frameTime=0, orbitAngle=0.45, orbitHeight=9, orbitDistance=31;
const keys=new Set();
const touch={pitch:0,roll:0,yaw:0,throttle:0,brake:0,trim:0};
const mouse={pitch:0,roll:0,active:false};
const controls=new FlightInputs(performance.now()/1000,settings.response);
const throttlePointers=new globalThis.Map();
const yawPointers=new globalThis.Map();
const brakePointers=new Set();
const trimPointers=new globalThis.Map();
// DOM timestamps retain the hold duration when rendering delays delivery of both events.
function queueControls(now=performance.now()/1000){
 const pressed=(...codes)=>codes.some(code=>keys.has(code))?1:0;
 const inputs={pitch:(pressed('KeyS','ArrowDown')-pressed('KeyW','ArrowUp')+touch.pitch+(mouse.active?mouse.pitch:0))*(settings.invertPitch?-1:1),roll:pressed('KeyD','ArrowRight')-pressed('KeyA','ArrowLeft')+touch.roll+(mouse.active?mouse.roll:0),yaw:pressed('KeyE')-pressed('KeyQ')+touch.yaw,throttle:pressed('ShiftLeft','ShiftRight')-pressed('ControlLeft','ControlRight')+touch.throttle,brake:flight.type.flight.rotorcraft?0:Math.max(pressed('KeyB'),touch.brake),
  // Pitch trim (src/flight.js): ] turns the wheel nose up, [ nose down. Never inverted, never a reason to drop assist.
  trim:hasPitchTrim(flight.type)?THREE.MathUtils.clamp(pressed('BracketRight')-pressed('BracketLeft')+touch.trim,-1,1):0};
 // Manual intent disengages assist before the gradual onset, including very short taps.
 if(Math.abs(inputs.pitch)+Math.abs(inputs.roll)+Math.abs(inputs.yaw)>(flight.type.flight.rotorcraft?0.001:0.12)||(flight.type.flight.rotorcraft&&Math.abs(inputs.throttle)>.001))flight.state.autopilot=false;
 controls.set(inputs,now);
}
function clearControls(){
 keys.clear();touch.pitch=touch.roll=touch.yaw=touch.throttle=touch.brake=touch.trim=0;mouse.pitch=mouse.roll=0;mouse.active=false;
 throttlePointers.clear();yawPointers.clear();brakePointers.clear();trimPointers.clear();for(const id of ['trim-up','trim-down'])$(id).classList.remove('active');flight.state.brake=0;$('touch-brake').classList.remove('active');$('touch-brake').setAttribute('aria-pressed','false');resetYoke();controls.reset(performance.now()/1000);
}
const cameraPosition=new THREE.Vector3(),target=new THREE.Vector3(),offset=new THREE.Vector3();
const horizontalQuat=new THREE.Quaternion(),horizontalEuler=new THREE.Euler();
// An aerobatic aircraft is followed along its nose, so the outside cameras never flip at the top of a loop.
const followFrame=new FollowFrame();
let initialCamera=true, cockpit=createCockpit(settings.aircraft), toastTimeout, lastNotice='', lastCrash=false, sceneDirty=true;
camera.add(cockpit);cockpit.visible=false;
const weatherData={clear:{label:'Clear skies',icon:'sun',temperature:'18°C',time:'14:32'},golden:{label:'Golden hour',icon:'cloud-sun',temperature:'16°C',time:'18:45'},overcast:{label:'Cloud cover',icon:'cloud',temperature:'12°C',time:'11:20'}};
const windChoices={calm:{label:'Calm',description:'Still air, as before.'},breeze:{label:'Breeze',description:'A steady wind; it drifts you off track.'},gusts:{label:'Gusts',description:'Stronger, gusting and veering wind.'}};
const windReport=()=>{const t=windText(flight.wind.config);return t==='Calm'?'Wind calm':`Wind ${t}`;};
// It reads the wind blowing (crosswind practice's while it owns it), so the activity UI refreshes it; it only writes on a change.
let weatherText='';
function updateWeatherPanel(){const w=weatherData[settings.weather],html=`${w.temperature} <span class="separator">/</span> ${windReport()}`;if(html!==weatherText)$('weather-description').innerHTML=weatherText=html;}
function setWeather(value,notify=true){
 settings.weather=value;world.setWeather(value);sceneDirty=true;const w=weatherData[value];
 $('weather-label').textContent=w.label;updateWeatherPanel();$('world-time').textContent=w.time;
 const b=$('weather-btn');b.querySelector('svg').outerHTML=`<i data-lucide="${w.icon}"></i>`;refreshIcons();saveSettings();if(notify)toast(`${w.label} selected`);
}
// The wind blends in over a few flight seconds (src/wind.js), so a change never jolts the aircraft; the light is separate.
function setWind(value,notify=true){
 if(!windChoices[value])return false;
 // The activity that owns the wind saves the new choice and hands it back on exit (src/activity-wind.js).
 if(activities.holdPilotChoice(value)){settings.wind=value;saveSettings();updateWeatherPanel();if(notify)toast(`${windChoices[value].label} saved · it returns when this activity ends`);return true;}
 settings.wind=value;flight.setWind(value);sceneDirty=true;updateWeatherPanel();saveSettings();
 if(notify)toast(value==='calm'?'Calm air selected':`${windChoices[value].label} selected · ${windText(WIND_PRESETS[value])}`);return true;
}
function setQuality(value){settings.quality=value;renderer.setPixelRatio(Math.min(devicePixelRatio,value==='high'?1.75:value==='medium'?1.2:.85));renderer.shadowMap.enabled=value!=='low';world.setQuality?.(value);miniMap?.setQuality(value);chartMap?.setQuality(value);sceneDirty=true;$('quality-label').textContent=value.charAt(0).toUpperCase()+value.slice(1);saveSettings();}
setWeather(weatherData[settings.weather]?settings.weather:'clear',false);setQuality(settings.quality);
applyDisplay();
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('visible'),3000);}
function iconButton(id,icon){$(id).innerHTML=`<i data-lucide="${icon}"></i>`;refreshIcons();}
function setPaused(value){
 if(flight.state.crashed||activities.finished)return;
 paused=value;sceneDirty=true;$('pause-overlay').hidden=!paused;$('sim-status').textContent=paused?'Simulation paused':'Live simulation';
 $('pause-btn').setAttribute('aria-label',paused?'Resume flight':'Pause flight');iconButton('pause-btn',paused?'play':'pause');
 if(paused)clearControls();
}
function saveFlight(){const s=flight.state;if(s.flightTime<10)return;const entry={date:new Date().toISOString(),time:s.flightTime,distance:s.distance,maxAltitude:flightMaxAlt,aircraft:s.aircraft};savedFlights=recordFlight(savedFlights,entry);storeFlights(savedFlights);}
let flightMaxAlt=flight.state.position.y;
function restart(notify=true){resetAltitudeReminder();closeHeadingSelect();if(activities.kind==='recovery'){startRecovery();return;}if(activities.kind==='crosswind'){startCrosswind();return;}if(landing.status!=='idle'){startLanding();return;}if(course.status!=='idle'){startCourse();return;}saveFlight();flight.reset();flight.toggleAutopilot();resetTouchdown();flightMaxAlt=flight.state.position.y;flightTrail.length=0;trailOrigin.copy(flight.state.position);sceneDirty=true;paused=false;lastCrash=false;initialCamera=true;clearControls();$('pause-overlay').hidden=true;$('crash-overlay').hidden=true;$('sim-status').textContent='Live simulation';iconButton('pause-btn','pause');updateAssist();if(notify)toast('A fresh start. You have the skies.');}
// Every label that names the aircraft reads from the active fleet type.
// Rotorcraft land on fixed skids unless their type has fixed wheels; hover collective is per type.
const wheeled=t=>t.landingGear==='wheels',hoverPercent=t=>Math.round(t.flight.hoverCollective*100),capital=w=>w[0].toUpperCase()+w.slice(1);
function updateAircraftLabels(){
 const t=flight.type,h=!!t.flight.rotorcraft;$('aircraft-name').textContent=t.name;$('aircraft-type').textContent=`${t.type} · ${t.registration}`;$('aircraft-badge').textContent=t.badge;
 $('throttle-label').textContent=h?'Collective':'Throttle';$('throttle-slider').setAttribute('aria-label',h?'Rotor collective':'Engine throttle');
 $('touch-power-label').textContent=h?'Collective':'Power';$('throttle-up').setAttribute('aria-label',h?'Increase collective':'Increase throttle');$('throttle-down').setAttribute('aria-label',h?'Decrease collective':'Decrease throttle');
 $('touch-yaw').hidden=!h;$('touch-brake').hidden=h;$('touch-trim').hidden=!hasPitchTrim(t);$('trim-btn').disabled=!hasPitchTrim(t);$('trim-btn').title=hasPitchTrim(t)?'Pitch trim, + nose up: [ nose down, ] nose up, T or click for neutral':h?'No pitch trim on a helicopter':'Holds any attitude hands-off · no trim needed';lastTrim=null;$('touch-yoke').setAttribute('aria-label',h?'Touch cyclic: forward, backward, left and right':'Touch flight joystick');
 $('gear-btn').disabled=h||!!t.fixedGear;$('flaps-btn').disabled=h||!!t.noFlaps;$('gear-btn').title=h?(wheeled(t)?'Fixed wheeled landing gear · always down':'Fixed landing skids'):t.fixedGear?'Fixed landing gear · always down':'Landing gear (G)';$('flaps-btn').title=h||t.noFlaps?'No flaps on this aircraft':'Flaps (F)';
 $('gear-label').textContent=h&&!wheeled(t)?'Skids':'Gear';$('flaps-label').textContent='Flaps';
 $('world').setAttribute('aria-label',h?'Helicopter world. W/S cyclic forward/backward, A/D lateral cyclic, Q/E yaw, Shift/Control collective, Space hover hold.':`Flight world. Use arrow keys to fly, shift and control for throttle, hold B for wheel brakes on the ground.${hasPitchTrim(t)?' Hold right bracket to trim nose up, left bracket to trim nose down, T for neutral trim.':''}`);
 $('key-hints').innerHTML=h?'<span><kbd>W</kbd><kbd>S</kbd>Cyclic</span><span><kbd>A</kbd><kbd>D</kbd>Lateral</span><span><kbd>Q</kbd><kbd>E</kbd>Yaw</span><span><kbd>⇧</kbd><kbd>Ctrl</kbd>Collective</span><span><kbd>Space</kbd>Hover hold</span>':'<span><kbd>W</kbd><kbd>S</kbd>Pitch</span><span><kbd>A</kbd><kbd>D</kbd>Roll</span><span><kbd>Q</kbd><kbd>E</kbd>Rudder</span><span><kbd>⇧</kbd><kbd>Ctrl</kbd>Throttle</span><span><kbd>B</kbd>Brakes</span>'+(hasPitchTrim(t)?'<span><kbd>[</kbd><kbd>]</kbd>Trim</span>':'')+'<span><kbd>P</kbd>Pause</span>';
}
// Switching aircraft saves the current flight, then starts the new type fresh in the air with flight assist on.
function setAircraft(id){
 const type=aircraftType(id);if(type.id===flight.type.id)return false;
 const was=activities.kind;cancelLanding(false);saveFlight();flight.setAircraft(type.id);settings.aircraft=type.id;saveSettings();
 scene.remove(aircraft.group);aircraft.dispose?.();aircraft=createAircraft(type.id);aircraft.paint.apply(loadAircraftTheme(type.id));scene.add(aircraft.group);world.reflectSky(aircraft.group);aircraft.setCockpit(view==='cockpit');
 camera.remove(cockpit);disposeObject(cockpit);cockpit=createCockpit(type.id);camera.add(cockpit);cockpit.visible=view==='cockpit';
 restart(false);updateAircraftLabels();toast(`${type.name} ready · ${was==='course'?'course cancelled · ':was==='crosswind'?'crosswind practice ended · ':was==='recovery'?'stall recovery ended · ':''}a fresh start in the air`);return true;
}
// ?airport=<id>&runway=<nn> selects a field as the picker does; &start=runway or &start=approach begins there.
// Selected airport and mission field for other views (the navigation map): airportState() here, window.aeronaut.getAirport(),
// and an 'aeronaut:airport' window event with the same detail whenever the selection or the mission field changes.
// `selected` is the field departures and new missions use; `mission` is the field of the mission underway (null in free flight).
const airportState=()=>({selected:selection.snapshot(),mission:landing.status==='idle'?null:{...describeField(landing.field),status:landing.status,phase:landing.phase}});
function announceAirport(){window.dispatchEvent(new CustomEvent('aeronaut:airport',{detail:airportState()}));}
function updateAirportUI(){$('landing-entry').innerHTML=`Land at ${selection.airport.name} <i data-lucide="arrow-up-right"></i>`;refreshIcons();}
selection.addEventListener('change',()=>{sceneDirty=true;settings.airport=selection.id;settings.runway=selection.runway;saveSettings();updateAirportUI();announceAirport();});
const query=new URLSearchParams(location.search);
if(query.has('airport'))selection.select(query.get('airport'),query.get('runway')||undefined);
const surfaceName=f=>f.surface==='grass'?'grass':'paved';
// A free-flight start on a 3° final, placed as the landing mission places it; no mission runs.
function approachStart(field=selection.field){cancelLanding(false);saveFlight();const m=new LandingMission(field);m.start(flight);m.cancel();resetTouchdown();flightMaxAlt=flight.state.position.y;flightTrail.length=0;trailOrigin.copy(flight.state.position);paused=false;lastCrash=false;initialCamera=true;sceneDirty=true;clearControls();$('pause-overlay').hidden=$('crash-overlay').hidden=true;updateAssist();toast(`${field.name} · final for runway ${field.runway}`);}
// A fresh departure: any aircraft may try any field in free flight; a poor fit is named, not refused.
function runwayStart(field=selection.field){
 cancelLanding(false);restart(false);const p=runwayPoint(100,0,field);flight.runwayStart(p.x,world.heightAt(p.x,p.z)+(flight.type.groundClearance??2.8),p.z,field.heading);resetTouchdown();trailOrigin.copy(flight.state.position);updateAssist();initialCamera=true;sceneDirty=true;
 const fit=suitability(field,flight.type.id),hint=flight.type.runwayHint;
 toast(fit.rating==='unsuitable'?`${flight.type.name}: ${fit.reason.toLowerCase()} · ${field.name} has ${field.runwayLength.toLocaleString('en')} m ${surfaceName(field)}`:/^Runway \d+/.test(hint)?hint.replace(/^Runway \d+/,`${field.name} · runway ${field.runway}`):`${field.name} · ${hint}`);
}
// Starts a scored mission at a field (default: retry the current mission's field). Unsuited aircraft get the brief instead.
function startLanding(field=landing.field){
 if(!missionAvailability(field,flight.type.id).available){cancelLanding(false);showDialog('landing');return false;}
 resetAltitudeReminder();saveFlight();activities.startLanding(flight,field);resetTouchdown();setMissionCues(field);flightMaxAlt=flight.state.position.y;flightTrail.length=0;trailOrigin.copy(flight.state.position);trailClock=0;
 paused=false;lastCrash=false;initialCamera=true;sceneDirty=true;missionResultShown=false;clearControls();
 $('pause-overlay').hidden=$('crash-overlay').hidden=$('landing-result').hidden=true;
 $('pause-btn').setAttribute('aria-label','Pause flight');iconButton('pause-btn','pause');
 settings.showHud=true;applyDisplay();saveSettings();
 setMissionCollapsed(false);
 updateAssist();updateLandingUI();announceAirport();toast(landing.profile.helicopter?'You have control · gently lower collective to settle in the box':`You have control · follow runway ${field.runway}, then flare and idle power`);return true;
}
// Ends whichever scored activity is underway; every caller wants free flight next.
function cancelLanding(fresh=false){
 resetAltitudeReminder();activities.cancel();missionResultShown=false;$('landing-result').hidden=true;landingCues.show(false);
 updateLandingUI();announceAirport();if(fresh){restart(false);toast('Free flight · a fresh start in the air');}
}
// Starts (or retries) the checkpoint course in the current aircraft; an aircraft the course is not built for gets the brief.
function startCourse(){
 if(!courseAvailability(flight.type).available){cancelLanding(false);showDialog('course');return false;}
 resetAltitudeReminder();saveFlight();activities.startCourse(flight);flight.toggleAutopilot();resetTouchdown();flightMaxAlt=flight.state.position.y;flightTrail.length=0;trailOrigin.copy(flight.state.position);trailClock=0;
 paused=false;lastCrash=false;initialCamera=true;sceneDirty=true;missionResultShown=false;lastCourseEvent=null;clearControls();
 $('pause-overlay').hidden=$('crash-overlay').hidden=$('landing-result').hidden=true;
 $('pause-btn').setAttribute('aria-label','Pause flight');iconButton('pause-btn','pause');
 settings.showHud=true;applyDisplay();saveSettings();
 setMissionCollapsed(false);
 updateAssist();updateLandingUI();announceAirport();toast('Assist holds you level toward gate 1 · steer to take control');return true;
}
// Starts (or retries) crosswind practice in the current aircraft: the landing mission at Alpine Field 36 in its own wind.
// The selected airport is untouched; an aircraft the practice is not built for gets the brief instead.
function startCrosswind(){
 if(!practiceAvailability(flight.type).available){cancelLanding(false);showDialog('crosswind');return false;}
 resetAltitudeReminder();saveFlight();activities.startCrosswind(flight);resetTouchdown();setMissionCues(landing.field);flightMaxAlt=flight.state.position.y;flightTrail.length=0;trailOrigin.copy(flight.state.position);trailClock=0;
 paused=false;lastCrash=false;initialCamera=true;sceneDirty=true;missionResultShown=false;clearControls();
 $('pause-overlay').hidden=$('crash-overlay').hidden=$('landing-result').hidden=true;
 $('pause-btn').setAttribute('aria-label','Pause flight');iconButton('pause-btn','pause');
 settings.showHud=true;applyDisplay();saveSettings();
 setMissionCollapsed(false);
 const b=practiceBrief(flight.type);
 updateAssist();updateLandingUI();announceAirport();toast(`You have control · wind ${b.report} · crab ${b.side} into it`);return true;
}
// The Mira T2's manual stall-recovery attempt; unsupported aircraft stay selected until an explicit switch.
function startRecovery(){
 if(!recoveryAvailability(flight.type).available){showDialog('recovery');return false;}
 resetAltitudeReminder();saveFlight();activities.startRecovery(flight);resetTouchdown();flightMaxAlt=flight.state.position.y;flightTrail.length=0;trailOrigin.copy(flight.state.position);trailClock=0;
 paused=false;lastCrash=false;initialCamera=true;sceneDirty=true;missionResultShown=false;clearControls();closeHeadingSelect();
 $('pause-overlay').hidden=$('crash-overlay').hidden=$('landing-result').hidden=true;
 $('pause-btn').setAttribute('aria-label','Pause flight');iconButton('pause-btn','pause');
 settings.showHud=true;applyDisplay();saveSettings();setMissionCollapsed(false);
 updateAssist();updateLandingUI();announceAirport();toast('Mira T2 · calm air · idle power to slow; you have manual control');return true;
}
// Crosswind practice words: whole degrees and knots, and the side a crab or offset is on.
const knots=v=>Math.round(Math.abs(v)*1.94384),wholeDegrees=r=>Math.round(Math.abs(r)*180/Math.PI);
// Fixed-wing phones fly with the touch yoke alone: no rudder buttons, so crosswind words name a bank.
const touchYoke=()=>$('touch-yoke').offsetParent!==null;
function updateLandingUI(){
 const underway=landing.status!=='idle',s=flight.state,f=landing.field,racing=course.status!=='idle',practicing=activities.kind==='crosswind',recovering=activities.kind==='recovery';
 updateWeatherPanel();
 // landing-mode is the mission card layout, shared by the landing mission and the checkpoint course.
 document.body.classList.toggle('landing-mode',underway||racing||recovering);
 document.body.classList.toggle('course-mode',racing);
 document.body.classList.toggle('recovery-mode',recovering);
 document.body.classList.toggle('landing-finished',activities.finished);
 $('flight-mode').textContent=recovering?'Stall recovery':practicing?'Crosswind practice':underway?'Landing mission':racing?'Checkpoint course':'Free flight';
 document.querySelector('.map-explore').textContent=recovering?'Stall recovery':practicing?`Crosswind · runway ${f.runway}`:underway?`Landing · runway ${f.runway}`:racing?'Checkpoint course':'Free exploration';
 $('mission-title').textContent=recovering?'Mira T2 · stall recovery':underway?`${f.name} · ${f.runway}`:racing?course.course.name:'The Swiss Alps';
 $('landing-guidance').hidden=!underway;$('course-guidance').hidden=!racing;$('recovery-guidance').hidden=!recovering;
 $('landing-entry').hidden=$('course-entry').hidden=$('crosswind-entry').hidden=$('recovery-entry').hidden=underway||racing||recovering;
 landingCues.show(landing.active,landing.profile?.helicopter,landing.profile?.clearance);
 courseGates.update(racing,course.next);
 if(recovering)return updateRecoveryUI();
 if(racing)return updateCourseUI();
 if(!underway)return;
 const p=landing.profile,g=landing.guidance(s),h=p.helicopter,rollout=landing.phase==='rollout';
 $('landing-phase').textContent=rollout?'Touchdown · controlled rollout':h?`Precision landing · fixed ${p.contact}`:`Final runway ${f.runway} · ${g.distance>0?(g.distance/1000).toFixed(2)+' km to threshold':'over runway'}`;
 $('landing-speed').textContent=rollout?'Below 6 kt':h?`Below ${Math.round(p.maxSpeed*1.94384)} kt`:`${Math.round(p.speed*1.94384)} kt`;
 $('landing-path-label').textContent=rollout?'Runway left':h?'Height above runway':'Glide path';
 $('landing-path').textContent=rollout?`${Math.round(g.remaining)} m`:h?`${Math.max(0,Math.round(g.height*3.28084))} ft`:Math.abs(g.pathError)<4?'On path':`${Math.round(Math.abs(g.pathError)*3.28084)} ft ${g.pathError>0?'high':'low'}`;
 let cue=rollout?(h?'Lower collective · stay settled':'Idle power · hold B to brake · keep straight with Q / E'):h?`Ease down with collective; ${Math.round(p.throttle*100)}% holds a hover.`:g.height<8?'Flare gently with S · reduce power with Ctrl':'Follow the chartreuse cues · small pitch corrections.';
 if(!rollout&&Math.abs(g.cross)>8)cue=`${Math.round(Math.abs(g.cross))} m ${g.cross>0?'right':'left'} of centre · correct gently`;
 else if(!rollout&&g.alignment>12)cue=`Align with runway ${f.runway} · heading ${headingDegrees(f.heading)}°`;
 else if(!rollout&&!h&&(s.speed<p.speedMin||s.speed>p.speedMax))cue=s.speed>p.speedMax?'Too fast · ease power down with Ctrl':'Too slow · add power with Shift';
 if(practicing&&!rollout&&!landing.finished){
  // Crosswind cues come from the actual drift over the ground (the flight-path marker's track), not from a model of it;
  // fixed-wing phones (touch yoke, no rudder buttons) get bank and wings-level wording (src/crosswind-practice.js).
  const x=practice.guidance(s,groundTrack(s,flight.type));
  cue=practiceCue({height:g.height,alignment:g.alignment*Math.PI/180,crab:x.crab,drift:x.drift,cross:g.cross,side:practiceBrief(flight.type).side,rudder:!touchYoke()})??cue;
 }
 $('landing-cue').textContent=cue;
 $('landing-objective').textContent=rollout?`Stay on runway · ${h?`collective <${Math.round(p.settlePower*100)}%`:'power <20%'} · settle 2 sec (${Math.min(2,landing.stableTime).toFixed(1)}/2)`:`${h?`${capital(p.contact)} fixed`:`${flight.type.fixedGear?'Gear fixed':`Gear ${s.gearDown?'down':'UP'}`} · ${flight.type.noFlaps?'no flaps':`flaps ${s.flaps*15}°`}`} · sink <${Math.round(p.maxSink*196.85)} fpm · alignment ≤12°`;
 if(landing.finished&&!missionResultShown){
  missionResultShown=true;clearControls();clearTimeout(toastTimeout);$('toast').classList.remove('visible');$('pause-overlay').hidden=$('crash-overlay').hidden=true;
  const success=landing.status==='success',t=landing.touchdown;
  $('sim-status').textContent=success?'Landing complete':'Mission ended';
  $('landing-result-status').textContent=practicing?(success?'Crosswind practice complete':'Crosswind practice'):success?'Mission complete':'Try the approach again';
  $('landing-result-title').textContent=success?(practicing?'A crosswind landing.':`Welcome to ${f.name}.`):'Landing not completed.';
  $('landing-result-reason').textContent=(success?(h?`${capital(p.contact)} settled safely in the target box.`:`Safe touchdown and controlled rollout on runway ${f.runway}.`):practicing?`${landing.reason}.`:landing.reason)+(practicing?` ${crosswindAdvice(practice.feedback(),landing,practiceBrief(flight.type).side,{rudder:!touchYoke()})}`:'');
  $('landing-result-metrics').innerHTML=t?`<div><dt>Touchdown sink</dt><dd>${Math.round(t.sink*196.85)} <small>fpm</small></dd></div><div><dt>Alignment</dt><dd>${t.alignment.toFixed(1)}<small>°</small></dd></div><div><dt>Touchdown speed</dt><dd>${Math.round(t.speed*1.94384)} <small>kt</small></dd></div><div><dt>Centreline offset</dt><dd>${Math.abs(t.cross).toFixed(1)} <small>m</small></dd></div>`:'<p>No runway touchdown recorded.</p>';
  if(practicing){const c=practice.feedback().crab,b=practiceBrief(flight.type);$('landing-result-metrics').insertAdjacentHTML('beforeend',`<div><dt>Crab on final</dt><dd>${c===null?'—':`${wholeDegrees(c)}<small>°${wholeDegrees(c)?` ${c>=0?'right':'left'}`:''}</small>`}</dd></div><div><dt>Crosswind</dt><dd>${knots(b.crosswind)} <small>kt from the ${b.side}</small></dd></div>`);}
  $('landing-result-retry').innerHTML=`${practicing?'Retry crosswind practice':'Retry landing'} <i data-lucide="rotate-ccw"></i>`;refreshIcons();
  $('landing-result').hidden=false;$('landing-result-retry').focus();sceneDirty=true;announceAirport();
 }else if(!landing.finished)$('sim-status').textContent=paused?'Simulation paused':practicing?'Crosswind practice · live':'Landing mission · live';
}
// The course card: compact progress and time, the next gate's cue, and a short note when a pass did not count.
let lastCourseEvent=null,courseEventUntil=0,courseEventText='';
const courseEventMessage=e=>({gate:'',missed:`Gate ${e.gate+1} missed · fly through its opening`,backward:`Gate ${e.gate+1} flown backwards · enter from the front`,order:`Gate ${e.gate+1} is out of order · fly gate ${course.next+1} first`,jump:''})[e.type];
function updateCourseUI(){
 const s=flight.state,g=course.guidance(s),total=course.course.gates.length,now=performance.now();
 if(course.event&&course.event!==lastCourseEvent){lastCourseEvent=course.event;const e=course.event;
  if(e.type==='gate'&&course.active)toast(`Gate ${e.gate+1} of ${total} · ${formatCourseTime(e.time)}`);
  courseEventText=courseEventMessage(e);courseEventUntil=courseEventText?now+3500:0;}
 $('course-phase').textContent=course.finished?(course.status==='complete'?'Course complete':'Run ended'):`Gate ${course.next+1} of ${total}${g?` · ${g.distance>=1000?(g.distance/1000).toFixed(1)+' km':Math.round(g.distance/10)*10+' m'}`:''}`;
 const pips=$('course-pips');if(pips.childElementCount!==total)pips.innerHTML='<span></span>'.repeat(total);
 [...pips.children].forEach((p,i)=>{p.className=i<course.next?'done':i===course.next?'next':'';});
 $('course-time').textContent=formatCourseTime(course.elapsed);
 $('course-next').textContent=`${Math.min(course.next+1,total)} / ${total}`;
 let cue='Fly through the chartreuse gate, front to back.';
 if(g){const deg=Math.round(Math.abs(g.relative)*180/Math.PI),feet=Math.round(g.height*3.28084/10)*10;
  if(g.side==='behind')cue=`Gate ${g.number} is behind you · turn back and enter from the front`;
  else if(deg>8)cue=`Turn ${g.relative>0?'right':'left'} ${deg}° toward gate ${g.number}`;
  else if(Math.abs(g.height)>25)cue=`${Math.abs(feet)} ft ${g.height>0?'high · ease the nose down':'low · raise the nose'}`;
  else cue=`Gate ${g.number} straight ahead · hold it steady`;}
 if(now<courseEventUntil)cue=courseEventText;
 $('course-cue').textContent=cue;
 $('course-best-reading').hidden=course.best===null;if(course.best!==null)$('course-best').textContent=formatCourseTime(course.best);
 $('course-objective').textContent=`Gates in order, front to back · pause stops the clock${course.best!==null?` · best ${formatCourseTime(course.best)}`:''}`;
 if(course.finished&&!missionResultShown){
  missionResultShown=true;clearControls();clearTimeout(toastTimeout);$('toast').classList.remove('visible');$('pause-overlay').hidden=$('crash-overlay').hidden=true;
  const done=course.status==='complete',split=course.splits.at(-1);
  $('sim-status').textContent=done?'Course complete':'Run ended';
  $('landing-result-status').textContent=done?(course.newBest?'Course complete · best this session':'Course complete'):'Checkpoint course';
  $('landing-result-title').textContent=done?`${formatCourseTime(course.elapsed)} through ${total} gates.`:'Run not completed.';
  $('landing-result-reason').textContent=done?`${flight.type.name} · ${course.course.name}. Gates counted only in order, through the opening, front to back.`:`${course.reason} after ${course.next} of ${total} gates.${course.next?' Gates already flown are not kept;':''} Retry starts again from the beginning.`;
  $('landing-result-metrics').innerHTML=`<div><dt>Course time</dt><dd>${formatCourseTime(course.elapsed)}</dd></div><div><dt>Gates</dt><dd>${course.next} <small>of ${total}</small></dd></div><div><dt>Best this session</dt><dd>${course.best!==null?formatCourseTime(course.best):'—'}</dd></div><div><dt>${done?'Average speed':'Last gate'}</dt><dd>${done?`${Math.round(course.course.length/course.elapsed*1.94384)} <small>kt</small>`:split!==undefined?formatCourseTime(split):'—'}</dd></div>`;
  $('landing-result-retry').innerHTML='Retry the course <i data-lucide="rotate-ccw"></i>';refreshIcons();
  $('landing-result').hidden=false;$('landing-result-retry').focus();sceneDirty=true;
 }else if(!course.finished)$('sim-status').textContent=paused?'Simulation paused':'Checkpoint course · live';
}
// Same mission card and quiet result surface; the measurements describe only what the controller observed.
function updateRecoveryUI(){
 const s=flight.state,r=RECOVERY,at=recovery.snapshot(),result=at.result;
 $('recovery-phase').textContent=at.phase==='slow'?'1 / 3 · Slow until the STALL warning':at.phase==='recover'?'2 / 3 · Lower nose and add power':'3 / 3 · Level out and hold steady';
 $('recovery-stable').textContent=`${Math.min(r.stableSeconds,at.stableTime).toFixed(1)} / 3 s`;
 $('recovery-cue').textContent=recovery.guidance(s,{touch:touchYoke()});
 const pitch=s.pitch*180/Math.PI;
 $('recovery-objective').textContent=`Nose ${pitch<-.5?'−':pitch>.5?'+':''}${Math.abs(pitch).toFixed(0)}° · power ${Math.round(s.throttle*100)}% · ${at.heightLost===null?'no stall yet':`${Math.round(at.heightLost*3.28084)} ft lost`}`;
 if(!recovery.finished){$('sim-status').textContent=paused?'Simulation paused':'Stall recovery · live';return;}
 if(missionResultShown)return;
 missionResultShown=true;clearControls();clearTimeout(toastTimeout);$('toast').classList.remove('visible');$('pause-overlay').hidden=$('crash-overlay').hidden=true;
 const success=recovery.status==='success';
 $('sim-status').textContent=success?'Recovery complete':'Attempt ended';
 $('landing-result-status').textContent='Mira T2 · stall recovery';
 $('landing-result-title').textContent=success?'Stable flight regained.':'Try the recovery again.';
 $('landing-result-reason').textContent=success?'A stall was recorded, followed by a lower nose attitude, added power and 3 seconds within the speed, attitude and vertical-speed targets in manual flight.':`${recovery.reason}. Retry begins wings level in the same calm setup.`;
 $('landing-result-metrics').innerHTML=`<div><dt>Stall to stable flight</dt><dd>${result.recoveryTime===null?'—':`${result.recoveryTime.toFixed(1)} <small>s</small>`}</dd></div><div><dt>Height lost after stall</dt><dd>${result.heightLost===null?'—':`${Math.round(result.heightLost*3.28084)} <small>ft</small>`}</dd></div><div><dt>Final airspeed</dt><dd>${Math.round(result.speed*1.94384)} <small>kt</small></dd></div><div><dt>Recorded stall</dt><dd>${at.stall?`${Math.round(at.stall.speed*1.94384)} <small>kt</small>`:'Not recorded'}</dd></div>`;
 $('landing-result-retry').innerHTML='Retry stall recovery <i data-lucide="rotate-ccw"></i>';refreshIcons();
 $('landing-result').hidden=false;$('landing-result-retry').focus();sceneDirty=true;
}
function updateAssist(){const a=flight.state.autopilot;document.querySelector('.mission-action').classList.toggle('manual',!a);document.querySelector('.mission-action').classList.toggle('rotorcraft',!!flight.type.flight.rotorcraft);$('assist-status').textContent=a?(flight.type.flight.rotorcraft?'Hover hold':flight.state.headingHold?`Assist · heading ${bugText(flight.state.selectedHeading)}°`:'Flight assist enabled'):'Manual flight';$('take-control').innerHTML=`${a?'Take control':'Enable assist'} <i data-lucide="arrow-up-right"></i>`;refreshIcons();}
function toggleAssist(){if(activities.finished)return;flight.toggleAutopilot();updateAssist();toast(flight.state.autopilot?(flight.type.flight.rotorcraft?'Hover hold · braking to hold position, altitude and heading':'Flight assist on · holding altitude and heading'):(flight.type.flight.rotorcraft?'Manual flight · cyclic to move, collective to climb or descend':'You have control · W/S to pitch, A/D to bank'));}
// Heading select (src/flight.js setHeadingTarget): a heading bug on the heading instrument and a compact selector above the
// strip. Choosing a value never steers; Hold heading engages assist on it, and with assist already on a new value retargets it
// at the held altitude. Space keeps capturing the heading flown now. Fixed-wing only; restarts and new starts clear it.
const headingSelect=$('heading-select'),headingBug=$('heading-bug'),headingInput=$('heading-input');let headingView='',bugPointer='';
const bugText=h=>h===null||h===undefined?'---':String(h).padStart(3,'0');
const currentHeading=()=>Math.round(flight.state.heading*180/Math.PI)%360;
function headingError(message){$('heading-select-state').textContent=message;$('heading-select-state').parentElement.classList.toggle('error',!!message);headingInput.parentElement.classList.toggle('invalid',!!message);headingView='';}
function selectHeading(value){
 const h=flight.setHeadingTarget(value);
 if(h===null){headingError('Enter a heading from 000 to 360');headingInput.value=bugText(flight.state.selectedHeading).replace('---','');headingInput.select();return null;}
 headingError('');headingInput.value=bugText(h);updateHeadingBug();return h;
}
function stepHeading(delta){selectHeading((flight.state.selectedHeading??currentHeading())+delta);}
function placeHeadingSelect(){
 if(headingSelect.hidden||innerWidth<=550){headingSelect.style.left='';return;}
 const strip=document.querySelector('.instruments'),cell=$('heading-instrument');
 headingSelect.style.left=`${THREE.MathUtils.clamp(cell.offsetLeft+cell.offsetWidth/2-headingSelect.offsetWidth/2,0,strip.clientWidth-headingSelect.offsetWidth)}px`;
}
function openHeadingSelect(){
 if(!hasHeadingSelect(flight.type))return;
 // Held flight keys are released first: nothing typed or tapped in here reaches the flight controls.
 clearControls();altitudeControls?.close();headingSelect.hidden=false;headingBug.setAttribute('aria-expanded','true');headingError('');headingInput.value=bugText(flight.state.selectedHeading).replace('---','');
 placeHeadingSelect();updateHeadingBug(true);
 // A tap opens on the step buttons without raising the on-screen keyboard; keyboard and mouse land in the field.
 if(bugPointer==='touch')headingSelect.focus({preventScroll:true});else{headingInput.focus({preventScroll:true});headingInput.select();}
}
function closeHeadingSelect(refocus=false){
 if(headingSelect.hidden)return;const inside=headingSelect.contains(document.activeElement);
 headingSelect.hidden=true;headingBug.setAttribute('aria-expanded','false');if(refocus||inside)headingBug.focus({preventScroll:true});
}
function holdHeading(){
 const s=flight.state;
 if(s.selectedHeading===null){headingError('Choose a heading first');return;}
 if(!flight.holdSelectedHeading()){toast(s.crashed?'Flight ended · restart to fly again':'On the ground · Hold heading works once airborne');return;}
 updateAssist();updateHeadingBug(true);
 toast(`Flight assist on · ${flight.recovering?'levelling first, then turning':'turning'} to ${bugText(s.selectedHeading)}° and holding altitude`);
}
function updateHeadingBug(force=false){
 const s=flight.state,fixed=hasHeadingSelect(flight.type),active=fixed&&s.autopilot&&s.headingHold,sel=s.selectedHeading,now=currentHeading();
 const blocked=sel===null||s.grounded||s.crashed||activities.finished;
 const key=[fixed,active,sel,now,blocked,s.grounded].join();if(!force&&key===headingView)return;
 const was=headingView.split(',')[1];headingView=key;
 $('heading-instrument').classList.toggle('rotorcraft-heading',!fixed);if(!fixed)closeHeadingSelect();
 $('heading-bug-value').textContent=`${bugText(sel)}${sel===null?'':'°'}`;headingBug.classList.toggle('selected',sel!==null);headingBug.classList.toggle('active',active);
 headingBug.setAttribute('aria-label',sel===null?'Selected heading: none. Choose a heading':`Selected heading ${bugText(sel)} degrees, ${active?'held by flight assist':'not held'}. Change heading`);
 $('heading-select-now').textContent=`Now ${bugText(now)}°`;
 if(!$('heading-select-state').parentElement.classList.contains('error'))$('heading-select-state').textContent=sel===null?'No heading selected':active?`Assist holding ${bugText(sel)}°`:s.grounded?'Selected · hold once airborne':'Selected · not held';
 if(sel!==null)headingInput.setAttribute('aria-valuenow',sel);else headingInput.removeAttribute('aria-valuenow');
 headingInput.setAttribute('aria-valuetext',sel===null?'none':`${bugText(sel)} degrees`);
 if(document.activeElement!==headingInput)headingInput.value=bugText(sel).replace('---','');
 const hold=$('heading-hold');hold.disabled=!active&&blocked;hold.classList.toggle('active',active);hold.setAttribute('aria-pressed',active);hold.textContent=active?`Holding ${bugText(sel)}°`:'Hold heading';
 if(String(active)!==was)updateAssist();
}
headingBug.addEventListener('pointerdown',e=>{bugPointer=e.pointerType;});// Space and Enter on the focused chip activate it natively (Space on its keyup) and stop here, so they never reach the
// window's Space = assist shortcut or its preventDefault; the key release still passes. Other flight keys behave as on
// any focused button.
headingBug.addEventListener('keydown',e=>{bugPointer='';if(e.code==='Space'||e.key===' '||e.key==='Enter')e.stopPropagation();});
headingBug.onclick=()=>headingSelect.hidden?openHeadingSelect():closeHeadingSelect(true);
$('heading-select-close').onclick=()=>closeHeadingSelect(true);$('heading-sync').onclick=()=>selectHeading(currentHeading());$('heading-hold').onclick=holdHeading;
headingSelect.querySelectorAll('[data-heading-step]').forEach(b=>b.onclick=()=>stepHeading(Number(b.dataset.headingStep)));
// Keys typed here edit the heading and never fly: no flight key, Space or shortcut reaches the window handler.
// Key releases still pass, so a key held before the selector opened is never left stuck down.
headingSelect.addEventListener('keydown',e=>{
 e.stopPropagation();
 if(e.key==='Escape'){e.preventDefault();closeHeadingSelect(true);return;}
 if(e.target!==headingInput)return;
 const step={ArrowUp:1,ArrowDown:-1,PageUp:10,PageDown:-10}[e.key];
 if(step){e.preventDefault();stepHeading(e.shiftKey&&Math.abs(step)===1?step*10:step);headingInput.select();}
 else if(e.key==='Enter'){e.preventDefault();selectHeading(headingInput.value);}
});
headingInput.addEventListener('change',()=>{if(headingInput.value.trim()!==bugText(flight.state.selectedHeading))selectHeading(headingInput.value);});
headingInput.addEventListener('input',()=>headingError(''));
document.addEventListener('pointerdown',e=>{if(!headingSelect.hidden&&!headingSelect.contains(e.target)&&!headingBug.contains(e.target))closeHeadingSelect();},true);
window.addEventListener('resize',placeHeadingSelect);
altitudeControls=createAltitudeReminderUI({monitor:altitudeReminder,getState:()=>flight.state,finished:()=>activities.finished,clearControls,closeHeading:closeHeadingSelect});
function setView(value,notify=true){sceneDirty=true;view=value;settings.camera=value;saveSettings();aircraft.setCockpit(view==='cockpit');if(cockpit)cockpit.visible=view==='cockpit';$('camera-label').textContent=({chase:'Chase camera',cockpit:'Cockpit view',orbit:'Orbit camera'})[view];initialCamera=true;if(notify)toast(`${$('camera-label').textContent}${view==='orbit'?' · drag to look around':''}`);}
function cycleView(){const views=['chase','cockpit','orbit'];setView(views[(views.indexOf(view)+1)%views.length]);}
function toggleMap(){settings.showMap=!settings.showMap;applyDisplay();saveSettings();drawMap();}
// Display preferences hide panels but never the stall, terrain and gear warnings, nor a mission card underway.
// While any of them is hidden a restore button stays on screen; it and H show everything again (toggleDisplay).
function applyDisplay(){
 if(!settings.showHud||!settings.showInstruments)altitudeControls?.close();
 const c=document.body.classList;c.toggle('hide-hud',!settings.showHud);c.toggle('hide-instruments',!settings.showInstruments);c.toggle('hide-hints',!settings.showHints);c.toggle('hide-crosshair',!settings.showCrosshair);
 $('map-panel').hidden=!settings.showMap;$('restore-hud').hidden=!anyDisplayHidden(settings);$('restore-hud').classList.toggle('partial',settings.showHud);placeRestore();sceneDirty=true;
}
// With the flight panels shown, the restore button sits beside the map and HUD tools, wherever the layout puts them.
function placeRestore(){
 const r=$('restore-hud');if(r.hidden||!settings.showHud){r.style.top=r.style.right='';return;}
 const tools=document.querySelector('.right-tools').getBoundingClientRect(),stage=document.querySelector('.flight-stage').getBoundingClientRect();
 r.style.top=`${tools.top-stage.top}px`;r.style.right=`${stage.right-tools.left+8}px`;
}
function toggleHud(){Object.assign(settings,toggleDisplay(settings));applyDisplay();saveSettings();drawMap();}
function gear(){if(flight.type.flight.rotorcraft||flight.type.fixedGear){toast(flight.type.fixedGear?'Fixed landing gear · always down':wheeled(flight.type)?'Fixed wheeled landing gear · always down':'Fixed landing skids · always down');return;}sceneDirty=true;flight.toggleGear();toast(`Landing gear ${flight.state.gearDown?'down':'retracted'}`);}
// Pitch trim survives pauses, dialogs and released keys; restarts, aircraft changes and new starts reset it (flight.reset).
// Tenths of a degree; the flight deck signs it (+ nose up), the phone column and notices say it in words.
const trimTenths=r=>Math.round(Math.abs(r)*1800/Math.PI)/10;
const trimText=r=>{const d=trimTenths(r);return d?`${d.toFixed(1)}° ${r>0?'up':'down'}`:'0.0°';};
const trimSigned=r=>{const d=trimTenths(r);return d?`${r>0?'+':'−'}${d.toFixed(1)}°`:'0.0°';};
const trimSpoken=r=>{const d=trimTenths(r);return d?`${d} degrees nose ${r>0?'up':'down'}`:'neutral';};
function resetTrim(){if(!hasPitchTrim(flight.type)){toast(flight.type.flight.rotorcraft?'No pitch trim on a helicopter':`The ${flight.type.name} holds any attitude hands-off · no trim needed`);return;}flight.state.pitchTrim=0;toast('Pitch trim neutral');}
let lastTrim=null;
function updateTrim(){
 const t=flight.type,on=hasPitchTrim(t),r=flight.state.pitchTrim,key=on?trimText(r):'off';if(key===lastTrim)return;lastTrim=key;
 $('trim-state').textContent=on?trimSigned(r):'N/A';$('touch-trim-state').textContent=key;$('trim-btn').classList.toggle('active',on&&key!=='0.0°');
 const label=on?`Pitch trim ${trimSpoken(r)}. Reset to neutral`:'No pitch trim on this aircraft';$('trim-btn').setAttribute('aria-label',label);$('touch-trim-reset').setAttribute('aria-label',label);
}
function flaps(){if(flight.type.flight.rotorcraft||flight.type.noFlaps){toast('No flaps on this aircraft');return;}sceneDirty=true;flight.cycleFlaps();toast(`Flaps set to ${flight.state.flaps*15}°`);}
$('pause-btn').onclick=()=>setPaused(!paused);$('resume-btn').onclick=()=>setPaused(false);$('reset-btn').onclick=()=>restart();$('crash-reset').onclick=()=>restart();$('take-control').onclick=toggleAssist;$('camera-btn').onclick=cycleView;$('map-toggle').onclick=toggleMap;$('map-close').onclick=toggleMap;$('map-framing').onclick=cycleMapFraming;$('map-zoom-in').onclick=()=>zoomMap(1);$('map-zoom-out').onclick=()=>zoomMap(-1);$('map-expand').onclick=()=>showDialog('chart');$('hud-toggle').onclick=toggleHud;$('restore-hud').onclick=toggleHud;$('gear-btn').onclick=gear;$('flaps-btn').onclick=flaps;$('trim-btn').onclick=resetTrim;$('touch-trim-reset').onclick=resetTrim;
$('landing-entry').onclick=()=>showDialog('landing');$('course-entry').onclick=()=>showDialog('course');$('crosswind-entry').onclick=()=>showDialog('crosswind');$('recovery-entry').onclick=()=>showDialog('recovery');
 $('recovery-retry').onclick=startRecovery;$('recovery-cancel').onclick=()=>cancelLanding(true);
$('course-retry').onclick=()=>startCourse();$('course-cancel').onclick=()=>cancelLanding(true);
$('landing-retry').onclick=()=>activities.kind==='crosswind'?startCrosswind():startLanding();$('landing-result-retry').onclick=()=>({course:startCourse,crosswind:startCrosswind,recovery:startRecovery})[activities.kind]?.()??startLanding();
for(const id of ['landing-cancel','landing-result-exit'])$(id).onclick=()=>cancelLanding(true);
// A new landing or course run always opens the card expanded, with its button saying so.
function setMissionCollapsed(collapsed){document.querySelector('.mission-panel').classList.toggle('collapsed',collapsed);iconButton('collapse-mission',collapsed?'plus':'minus');$('collapse-mission').setAttribute('aria-label',collapsed?'Expand flight details':'Collapse flight details');$('collapse-mission').setAttribute('aria-expanded',String(!collapsed));}
$('collapse-mission').onclick=()=>setMissionCollapsed(!document.querySelector('.mission-panel').classList.contains('collapsed'));
$('throttle-slider').addEventListener('input',e=>{flight.state.throttle=Number(e.target.value)/100;if(flight.type.flight.rotorcraft)flight.state.autopilot=false;});
// One audio context, unlocked by a gesture as browsers require. Sound starts off, as before; once the pilot turns
// it on, that choice is saved and resumes at the first tap or key press after a reload.
function updateSoundButton(){iconButton('sound-btn',audio.enabled?'volume-2':'volume-x');$('sound-btn').setAttribute('aria-label',audio.enabled?'Mute flight sound':'Enable flight sound');}
async function setSound(on){settings.muted=!on;saveSettings();if(on&&!audio.enabled)await audio.start();else if(!on&&audio.enabled)audio.toggle();updateSoundButton();return audio.enabled;}
audio.setVolume(settings.volume);
for(const event of ['pointerdown','keydown'])window.addEventListener(event,e=>{if(!settings.muted&&!audio.enabled&&!e.target?.closest?.('#sound-btn,#setting-sound'))audio.start().then(updateSoundButton);},{capture:true});
$('sound-btn').onclick=async()=>{const on=await setSound(!audio.enabled);toast(on?'Flight sound on':'Flight sound off');};
$('fullscreen-btn').onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch{toast('Open the preview in its own tab for fullscreen.');}};
document.addEventListener('fullscreenchange',()=>iconButton('fullscreen-btn',document.fullscreenElement?'minimize':'maximize'));
$('photo-btn').onclick=()=>{renderer.render(scene,camera);const a=document.createElement('a');a.download=`aeronaut-${Date.now()}.png`;a.href=renderer.domElement.toDataURL('image/png');a.click();toast('Flight photo saved');};
$('nav-flight').onclick=()=>{if($('main-dialog').open)$('main-dialog').close();};

const dialog=$('main-dialog');
let dialogType='', dialogReturnFocus=null, exploreReturn=null;
const paintEditor=createAircraftThemeEditor({renderer,getAircraft:()=>aircraft,getType:()=>flight.type,onChange:()=>{sceneDirty=true;},back:()=>{
 showDialog('explore');
 if(exploreReturn){dialog.scrollTop=exploreReturn.top;dialog.querySelector('.aircraft-options').scrollTop=exploreReturn.roster;}
 $('customize-aircraft').focus({preventScroll:true});
}});
// Native Escape, Done, close and backdrop all restore the launching control and the original pause state.
dialog.addEventListener('close',()=>{paintEditor.unmount();dialogType='';sceneDirty=true;dialogReturnFocus?.focus({preventScroll:true});});
dialog.addEventListener('keydown',event=>{
 if(dialogType!=='appearance')return;
 event.stopPropagation();
 if(event.key!=='Tab')return;
 const items=[...dialog.querySelectorAll('button,input')].filter(el=>!el.disabled&&el.tabIndex>=0),first=items[0],last=items.at(-1);
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
 else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
});
const dialogHead=title=>`<div class="dialog-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Close dialog"><i data-lucide="x"></i></button></div>`;
const toggleMarkup=(id,label,desc,value)=>`<div class="settings-row"><div><strong>${label}</strong><p>${desc}</p></div><button class="toggle" id="${id}" role="switch" aria-label="${label}" aria-checked="${value}"></button></div>`;
// Arrow keys, Home and End move through a radio group by clicking the next choice, as the aircraft roster does.
function radioKeys(selector){dialog.querySelectorAll(selector).forEach(b=>b.onkeydown=e=>{const items=[...dialog.querySelectorAll(selector)],i=items.indexOf(b),next={ArrowDown:(i+1)%items.length,ArrowRight:(i+1)%items.length,ArrowUp:(i+items.length-1)%items.length,ArrowLeft:(i+items.length-1)%items.length,Home:0,End:items.length-1}[e.key];if(next===undefined)return;e.preventDefault();const key=Object.keys(items[next].dataset)[0],value=items[next].dataset[key];items[next].click();const target=dialog.querySelector(`[data-${key}="${value}"]`);target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest'});});}
// Re-render Explore after a choice, keeping the roster scroll, dialog scroll and focus.
function rerenderExplore(focus){const scroll=dialog.querySelector('.aircraft-options')?.scrollTop??0,top=dialog.scrollTop;showDialog('explore');dialog.querySelector('.aircraft-options').scrollTop=scroll;dialog.scrollTop=top;dialog.querySelector(focus)?.focus({preventScroll:true});}
// Runway wind advice (src/runway-wind.js) from the wind the flight is in, for the selected field and runway. The
// band from the last look at the same runway gives the suggestion its hysteresis. Only the pilot's button applies it.
const adviceBands={};
function runwayAdvice(airport=selection.airport,runway=selection.runway){const key=`${airport.id}|${runway}`,a=adviseRunway(airport,runway,activities.pilotWind(flight.windSnapshot().config),flight.type.id,adviceBands[key]);adviceBands[key]=a.band;return a;}
const windArrow=(rotation,cls='')=>`<svg class="wind-arrow ${cls}" viewBox="0 0 16 16" aria-hidden="true" style="transform:rotate(${rotation}rad)"><path d="M8 14.5v-11M4.5 7 8 3l3.5 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function runwayWindMarkup(a){
 const w=a.wind,report=windText(activities.pilotWind(flight.windSnapshot().config)),sel=componentText(a.selected),oth=componentText(a.other),kt=v=>Math.round(Math.abs(v)/KNOT);
 // The diagram is runway-up: a vertical runway bar and the arrow of where the reported wind goes, relative to it.
 const diagram=`<span class="runway-wind-diagram" aria-hidden="true"><i></i>${w.calm?'':windArrow(w.direction+Math.PI-a.heading)}</span>`;
 const lines=w.calm?'<p>No wind: either direction lands and departs the same.</p>':`<p><b>Runway ${a.runway}</b> <span class="wind-${sel.tone}">${sel.text}</span></p><p><b>Runway ${a.reciprocal}</b> <span class="wind-${oth.tone}">${oth.text}</span></p>`;
 const g=a.gust,gust=g&&!w.calm?`<p class="runway-wind-gust">Gusts to ${kt(w.peak)} kt: crosswind up to ${kt(g.crosswind)} kt${g.tailwind>=KNOT?`, tailwind up to ${kt(g.tailwind)} kt`:''} on ${a.runway}.</p>`:'';
 const offer=a.recommended?(a.canApply?`<button class="secondary-btn" data-apply-runway="${a.recommended}">Use runway ${a.recommended} · into wind <i data-lucide="arrow-up-right"></i></button>`:`<p class="runway-wind-gust">The ${flight.type.name} does not suit ${selection.airport.name}, so no runway is suggested here.</p>`):'';
 const strong=a.strong&&!w.calm?`<p class="runway-wind-gust">${flight.type.flight.rotorcraft?'Strong crosswind: a hover drifts downwind, so hold the cyclic into the wind over the spot. Once down, the helicopter stays put.':'Strong crosswind: crab into the wind on final to hold the centreline, then straighten before touchdown. The wheels stop the drift.'}</p>`:'';
 return`<div class="runway-wind ${a.verdict}" role="group" aria-label="Wind for runway ${a.runway}"><div class="runway-wind-head">${diagram}<div><strong>${a.headline}</strong><span>Reported wind ${report==='Calm'?'calm':report} · advice uses the steady wind</span></div></div>${lines}${gust}${strong}${offer}</div>`;
}
const fitText=fit=>fit.rating==='recommended'?fit.reason:fit.rating==='suitable'?'Tight fit · little runway margin':`Not suited · ${fit.reason.toLowerCase()}`;
function airportOption(a){const fit=suitability(a,flight.type.id),on=a.id===selection.id;return`<button class="weather-option airport-option ${on?'selected':''}" role="radio" tabindex="${on?0:-1}" aria-checked="${on}" data-airport="${a.id}"><i data-lucide="map-pin"></i><div><strong>${a.name} <small>${a.ident}</small></strong><span>${region(a.region).name} · ${a.runwayLength.toLocaleString('en')} m ${surfaceName(a)} · ${a.elevation.toLocaleString('en')} m elev.</span><span class="airport-fit ${fit.rating}">${fitText(fit)}</span></div><span></span></button>`;}
function airportDetail(){
 const a=selection.airport,mission=landing.status!=='idle'&&(landing.field.id!==a.id||landing.field.runway!==selection.runway)?`Your ${activities.kind==='crosswind'?'crosswind practice':'landing'} at ${landing.field.name} ${landing.field.runway} continues. `:'';
 return`<div class="airport-detail"><div class="airport-runways" role="radiogroup" aria-label="Runway at ${a.name}">${a.runways.map(r=>{const on=r.designator===selection.runway;return`<button role="radio" aria-checked="${on}" tabindex="${on?0:-1}" data-runway="${r.designator}">Runway ${r.designator} <small>${headingDegrees(r.heading)}°</small></button>`;}).join('')}</div>${runwayWindMarkup(runwayAdvice())}<p>${a.summary} ${a.runwayLength.toLocaleString('en')} × ${a.runwayWidth} m. ${a.caution}</p><p class="dialog-note">${mission}Choosing a field moves nothing: departures and new landing missions start there.</p></div>`;
}
// The navigation chart: a larger map in a dialog (the flight pauses while it is open, as with every dialog).
function chartAirport(a){const on=a.id===navigationDestination(airportState())?.id,sel=a.id===selection.id,{bearing,distance}=bearingDistance(flight.state.position,a);return`<button class="chart-airport ${on?'selected':''}" role="radio" aria-checked="${sel}" tabindex="${sel?0:-1}" data-airport="${a.id}"><span class="chart-ident">${a.ident}</span><span class="chart-name">${a.name}<small>${region(a.region).name}</small></span><span class="chart-vector">${degrees(bearing)}° <small>${formatNM(distance)}</small></span></button>`;}
function drawChart(){
 if(!chartMap||!dialog.open)return;
 chartMap.draw(navScene(chartFraming,settings.quality==='low'?20:40)); // The flight is paused under a dialog, so the chart may sample more per update.
 const d=navigationDestination(airportState()),n=navReadout();
 const mission=d?.mission?`<p class="chart-mission">Landing mission · runway ${d.runway}. ${selection.id!==d.id?`${selection.airport.name} is selected for the next departure or mission.`:''}</p>`:'';
 const html=`<span class="chart-to">${d?`${d.mission?'Landing at':'To'} <strong>${d.name}</strong> <small>${d.ident}</small>`:'No destination'}</span><div class="chart-values"><div><span>Track</span><strong>${n.trackText}</strong></div><div><span>Groundspeed</span><strong>${n.groundSpeedText.replace(' kt','')} <small>kt</small></strong></div><div><span>Bearing</span><strong>${d?`${n.bearingText}°`:'—'}</strong></div><div><span>Distance</span><strong>${d?n.distanceText.replace(' NM',''):'—'} <small>NM</small></strong></div><div class="chart-ete"><span>Est. time to field</span><strong>${n.ete||'—'}</strong><em>${n.eteReason}</em></div></div>${mission}`;
 if($('chart-readout').innerHTML!==html)$('chart-readout').innerHTML=html;
 dialog.querySelectorAll('[data-framing]').forEach(b=>{const on=b.dataset.framing===chartFraming.framing;b.setAttribute('aria-checked',on);b.tabIndex=on||(chartFraming.framing==='free'&&b.dataset.framing==='route')?0:-1;});
 $('chart-canvas').setAttribute('aria-label',d?`Navigation chart, ${FRAMING_LABELS[chartFraming.framing].toLowerCase()} view. ${d.name} bears ${n.bearingText} degrees, ${n.distanceText.replace('NM','nautical miles')} from the aircraft.`:'Navigation chart');
}
function setupChart(){
 const canvas=$('chart-canvas');chartMap=new NavigationMap(canvas,{heightAt:world.heightAt,quality:settings.quality});
 if(chartFraming.framing==='free')Object.assign(chartFraming,{framing:'route'});
 const pan=(dx,dy)=>{const v=chartMap.view;if(!v)return;Object.assign(chartFraming,{framing:'free',cx:v.cx+dx*v.mpp,cz:v.cz+dy*v.mpp,zoom:nearestZoom(v.mpp*Math.min(v.width,v.height))});drawChart();};
 const zoom=dir=>{if(chartMap.view){const z=zoomFrom(chartFraming,chartMap.view,dir);Object.assign(chartFraming,z,z.framing==='free'?{}:{cx:undefined,cz:undefined});drawChart();}};
 const choose=id=>{if(id&&selection.select(id)){rerenderChartList(id);}};
 dialog.querySelectorAll('[data-framing]').forEach(b=>b.onclick=()=>{Object.assign(chartFraming,{framing:b.dataset.framing});drawChart();});
 radioKeys('[data-framing]');
 $('chart-zoom-in').onclick=()=>zoom(1);$('chart-zoom-out').onclick=()=>zoom(-1);
 dialog.querySelectorAll('.chart-airports [data-airport]').forEach(b=>b.onclick=()=>choose(b.dataset.airport));radioKeys('.chart-airports [data-airport]');
 let drag=null;
 canvas.onpointerdown=e=>{drag={x:e.clientX,y:e.clientY,moved:0};canvas.setPointerCapture(e.pointerId);};
 canvas.onpointermove=e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.moved+=Math.abs(dx)+Math.abs(dy);drag.x=e.clientX;drag.y=e.clientY;if(drag.moved>4)pan(-dx,-dy);};
 canvas.onpointerup=e=>{if(drag&&drag.moved<=4){const r=canvas.getBoundingClientRect();choose(chartMap.airportAt(e.clientX-r.left,e.clientY-r.top,e.pointerType==='touch'?26:18));}drag=null;};
 canvas.onpointercancel=()=>{drag=null;};
 canvas.onwheel=e=>{e.preventDefault();zoom(e.deltaY<0?1:-1);};
 canvas.onkeydown=e=>{const v=chartMap.view;if(!v)return;const step=Math.min(v.width,v.height)/5,k={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];
  if(k){e.preventDefault();pan(...k);}else if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1);}else if(e.key==='-'||e.key==='_'){e.preventDefault();zoom(-1);}};
 requestAnimationFrame(drawChart);
}
// Re-list the fields after a choice, keeping focus on the chosen one.
function rerenderChartList(id){const list=dialog.querySelector('.chart-airports');if(!list)return;list.innerHTML=AIRPORTS.map(chartAirport).join('');list.querySelectorAll('[data-airport]').forEach(b=>b.onclick=()=>{if(selection.select(b.dataset.airport))rerenderChartList(b.dataset.airport);});radioKeys('.chart-airports [data-airport]');list.querySelector(`[data-airport="${id}"]`)?.focus({preventScroll:true});drawChart();}
// A labelled range with its value beside the label; values are kept in the bounds settings.js validates.
const sliderMarkup=(id,label,value,{min,max,step})=>`<div class="settings-slider"><label for="${id}"><span>${label}</span><output id="${id}-value" for="${id}">${percent(value)}</output></label><input type="range" id="${id}" min="${Math.round(min*100)}" max="${Math.round(max*100)}" step="${Math.round(step*100)}" value="${Math.round(value*100)}" aria-valuetext="${percent(value)}"/></div>`;
function bindSlider(id,apply){$(id).oninput=e=>{const v=Number(e.target.value)/100;apply(v);$(`${id}-value`).textContent=percent(v);e.target.setAttribute('aria-valuetext',percent(v));saveSettings();};}
// Resets customization only: the aircraft, airfield, logbook and the flight or mission underway carry on where they are.
function restoreDefaults(){
 const d=resetSettings(settings);for(const key of CUSTOMIZATION_KEYS)settings[key]=d[key];
 setQuality(settings.quality);controls.setResponse(settings.response);clearControls();setView(settings.camera,false);applyDisplay();drawMap();audio.setVolume(settings.volume);
 if(settings.muted&&audio.enabled)audio.toggle();updateSoundButton();saveSettings();
 showDialog('settings');$('restore-defaults').focus();toast('Settings restored to defaults');
}
function showDialog(type){
 if(!dialog.open)dialogReturnFocus=document.activeElement;
 if(type==='appearance'&&dialogType==='explore')exploreReturn={top:dialog.scrollTop,roster:dialog.querySelector('.aircraft-options').scrollTop};
 if(dialogType==='appearance')paintEditor.unmount();
 dialogType=type;
 clearControls();closeHeadingSelect();altitudeControls?.close();
 const heli=!!flight.type.flight.rotorcraft;
 let content='';
 if(type==='menu'){content=dialogHead('Flight deck')+`<div class="dialog-body"><button class="menu-link" data-next-dialog="explore">Explore the Alps <i data-lucide="arrow-up-right"></i></button><button class="menu-link" data-next-dialog="chart">Navigation chart <i data-lucide="arrow-up-right"></i></button><button class="menu-link" data-next-dialog="logbook">Flight log <i data-lucide="arrow-up-right"></i></button><button class="menu-link" data-next-dialog="controls">Flight controls <i data-lucide="arrow-up-right"></i></button><button class="menu-link" data-next-dialog="environment">Weather <i data-lucide="arrow-up-right"></i></button></div>`;}else if(type==='environment'){
 content=dialogHead('A change of atmosphere')+`<div class="dialog-body"><p>Find your favorite light. Weather presets change the atmosphere, sunlight, visibility, and water.</p><div class="weather-options">${Object.entries(weatherData).map(([id,w])=>`<button class="weather-option ${settings.weather===id?'selected':''}" data-weather="${id}"><i data-lucide="${w.icon}"></i><div><strong>${w.label}</strong><span>${id==='clear'?'Blue skies. Endless visibility.':id==='golden'?'Warm light across the mountains.':'A moody sky above the valley.'}</span></div><span></span></button>`).join('')}</div><h3 class="dialog-section-title">Wind</h3><div class="settings-row wind-row"><div><strong>${settings.wind==='calm'?'Calm air':`${windChoices[settings.wind].label} · ${windText(WIND_PRESETS[settings.wind])}`}</strong><p id="wind-now">${practice.owning||recovery.owning?`${practice.owning?'Crosswind practice':'Stall recovery'} holds ${windText(flight.windSnapshot().config)} for its attempt; this choice returns when it ends.`:`${windChoices[settings.wind].description} ${flight.windSnapshot().transitioning?'Blends in over a few flight seconds.':`${sampleText(flight.sampleWind())}.`}`}</p></div><div class="segmented" role="radiogroup" aria-label="Wind">${Object.entries(windChoices).map(([id,w])=>`<button role="radio" data-wind="${id}" aria-checked="${settings.wind===id}" tabindex="${settings.wind===id?0:-1}">${w.label}</button>`).join('')}</div></div><p class="dialog-note">Simulated weather presets. This is a procedural alpine world. Wind is chosen apart from the light: it moves the aircraft over the ground and the windsocks show it, while airspeed stays airspeed.</p></div>`;
 }else if(type==='settings'){
 const responseLabels=heli?['Cyclic fore / aft','Cyclic left / right','Yaw pedals','Collective']:['Pitch','Roll','Rudder','Throttle'];
 content=dialogHead('Make it your flight')+`<div class="dialog-body settings-body"><h3 class="dialog-section-title">Flight</h3><div class="settings-row"><div><strong>Graphics quality</strong><p>Balance detail with a smooth flight.</p></div><select id="graphics-quality" aria-label="Graphics quality"><option value="high" ${settings.quality==='high'?'selected':''}>High</option><option value="medium" ${settings.quality==='medium'?'selected':''}>Balanced</option><option value="low" ${settings.quality==='low'?'selected':''}>Performance</option></select></div>${toggleMarkup('setting-assist','Flight assist',heli?'Brakes to a hover; holds position, altitude and heading.':'Holds your heading and altitude.',flight.state.autopilot)}${toggleMarkup('setting-invert','Invert pitch','Swap the up and down flight controls.',settings.invertPitch)}${toggleMarkup('setting-mouse','Mouse steering','Drag across the world to pitch and bank.',settings.mouseSteering)}`
 +`<h3 class="dialog-section-title">Control response</h3><p class="settings-help">How quickly keys, mouse and touch reach full deflection. Holding always gives full travel; 100% is the gentle default.</p><div class="settings-sliders">${['pitch','roll','yaw','throttle'].map((axis,i)=>sliderMarkup(`response-${axis}`,responseLabels[i],settings.response[axis],RESPONSE)).join('')}</div>`
 +`<h3 class="dialog-section-title">Camera</h3><div class="settings-row"><div><strong>View</strong><p>Saved for your next flight; C cycles it.</p></div><div class="segmented" role="radiogroup" aria-label="Camera view">${[['chase','Chase'],['cockpit','Cockpit'],['orbit','Orbit']].map(([id,label])=>`<button role="radio" data-view="${id}" aria-checked="${view===id}" tabindex="${view===id?0:-1}">${label}</button>`).join('')}</div></div><div class="settings-sliders single">${sliderMarkup('chase-distance','Chase distance',settings.chaseDistance,CHASE_DISTANCE)}</div>`
 +`<h3 class="dialog-section-title">Sound</h3>${toggleMarkup('setting-sound','Flight sound','Engines, wind and warning horns.',!settings.muted)}<div class="settings-sliders single">${sliderMarkup('master-volume','Master volume',settings.volume,VOLUME)}</div>`
 +`<h3 class="dialog-section-title">Display</h3>${toggleMarkup('setting-hud','Flight panels','Mission, weather and camera panels. Warnings stay visible; H shows everything.',settings.showHud)}${toggleMarkup('setting-instruments','Instrument strip','Airspeed, altitude, attitude, throttle and pause.',settings.showInstruments)}${toggleMarkup('setting-hints','Key hints','Keyboard reminders and frame rate.',settings.showHints)}${toggleMarkup('setting-crosshair','Crosshair','The centre marker ahead of the aircraft.',settings.showCrosshair)}${toggleMarkup('setting-flight-path','Flight path marker','Where the aircraft is actually travelling, not where the nose points. Off by default; hidden with the flight panels.',settings.showFlightPath)}${toggleMarkup('setting-map','Navigation map','Show your position above the valley.',settings.showMap)}`
 +`<div class="settings-actions"><button class="secondary-btn" id="restore-defaults"><i data-lucide="rotate-ccw"></i>Restore defaults</button><button class="primary-btn" data-close>Back to the skies <i data-lucide="arrow-up-right"></i></button></div><p class="dialog-note">Restoring defaults keeps your aircraft, airfield, flight log and the flight in progress.</p></div>`;
 }else if(type==='controls'){
 const controls=[[heli?'Cyclic forward / backward':'Pitch down / up',['W','S']],[heli?'Cyclic left / right':'Bank left / right',['A','D']],['Alternate flight controls',['←','↑','↓','→']],[heli?'Yaw left / right':'Rudder left / right',['Q','E']],[heli?'Raise / lower collective':'Increase / decrease throttle',['Shift','Ctrl']],...(heli?[]:[['Wheel brakes · hold on the ground',['B']]]),...(hasPitchTrim(flight.type)?[['Trim nose down / up · hold to adjust',['[',']']],['Neutral trim',['T']]]:[]),['Change camera',['C']],['Pause / resume',['P']],[heli?'Hover hold':'Flight assist',['Space']],...(!heli&&!flight.type.fixedGear?[['Landing gear',['G']]]:[]),...(!heli&&!flight.type.noFlaps?[['Cycle flaps',['F']]]:[]),['Navigation map',['M']],['Map zoom out / in',['−','+']],['Map framing',['V']],['Navigation chart',['N']],['Hide instruments',['H']],['Restart flight',['R']]];
 content=dialogHead('You have control')+`<div class="dialog-body"><p>${heli?`${hoverPercent(flight.type)}% collective hovers. Tilt forward with W to move; center the cyclic to level. Space brakes into a steady hover.`:'A little input goes a long way. Bank gently into turns and add power to climb.'}</p><div class="controls-list">${controls.map(([label,k])=>`<div class="control-row"><span>${label}</span><span>${k.map(v=>`<kbd>${v}</kbd>`).join('')}</span></div>`).join('')}</div><p class="dialog-note">On a phone, drag the left ${heli?'cyclic':'yoke'} to steer and hold + / − to adjust ${heli?'collective; use the two yaw buttons to turn':`throttle, and hold Brake to slow on the ground${hasPitchTrim(flight.type)?'. Hold the trim arrows to set a hands-off climb or descent; tap the value between them for neutral':''}`}. In orbit view, drag to look around and scroll to zoom. ${flight.type.name}: ${flight.type.help}</p><p class="dialog-note">Altitude reminder: open Set beside Altitude. Set feet MSL or Use current; selection arms a reminder, never flight assist. Acknowledge quiets the alert; Disarm stops monitoring. Helicopters use the same MSL reminder, separate from hover hold.</p>${heli?'':'<p class="dialog-note">Heading select: open Sel on the heading instrument, type or step a heading (arrow keys ±1°, Page Up / Down ±10°), then Hold heading. Choosing a value alone never steers; with assist on, a new value turns to it at the held altitude. Assist holds the nose heading, so wind can drift the track. Any stick or rudder input hands control back.</p>'}<p class="dialog-note">Navigation: Track is the direction of travel over the ground; Groundspeed includes wind drift. Compare them with nose heading and airspeed on the instruments. The chart estimates time to the field at present closing speed and shows Not closing for little, sideways or outbound progress.</p>${heli?'':'<p class="dialog-note">Glide-path lights beside the selected runway: two white and two red is on the landing path, more white is high, more red is low.</p>'}</div>`;
 }else if(type==='landing'){
 const f=selection.field,p=landingProfile(flight.type),h=p.helicopter,fit=missionAvailability(selection.airport,flight.type.id),hdg=headingDegrees(f.heading),name=flight.type.name;
 const caution=[fit.rating==='suitable'?`Tight fit for the ${name}: little runway to spare after the touchdown zone.`:'',f.caution].filter(Boolean).join(' ');
 content=dialogHead(`Land at ${f.name}`)+`<div class="dialog-body landing-brief"><span class="landing-eyebrow">Landing mission · runway ${f.runway} · heading ${hdg}° · ${f.elevation.toLocaleString('en')} m</span><h3>${name}</h3>${runwayWindMarkup(runwayAdvice())}`+(fit.available?`<p>${h?`Begin in a hover 46 ft above the marked ${p.contact==='wheels'?'landing':'skid'} box. Ease down with collective; keep the cyclic centred and use Q / E to face ${hdg}°.`:`Begin on a short final for runway ${f.runway}, heading ${hdg}°, with ${flight.type.fixedGear?'fixed gear': 'gear down'} and ${flight.type.noFlaps?'no flaps':'full flaps'}. Follow the three chartreuse approach cues to the outlined touchdown zone.`}</p>${h?'':'<p>Four glide-path lights beside the touchdown zone show the same path: two white and two red is on path, more white is high, more red is low. A simplified training aid, not a certified PAPI.</p>'}${caution?`<p class="mission-caution"><i data-lucide="triangle-alert"></i><span>${caution}</span></p>`:''}<ol><li>${h?`Land inside the small chartreuse box, level and below ${Math.round(p.maxSpeed*1.94384)} kt.`:`Hold ${Math.round(p.speed*1.94384)} kt on approach. W / S adjusts pitch; Shift / Ctrl adjusts power.`}</li><li>${h?`Start at ${Math.round(p.throttle*100)}% collective in a hover. Lower toward ${Math.round(p.throttle*100)-3}% with short taps to descend.`:'Near 25 ft above the runway, gently raise the nose with S to soften the descent. Reduce power with Ctrl.'}</li><li>Touch down below ${Math.round(p.maxSink*196.85)} ft/min, aligned within 12°. ${h?`Keep collective below ${Math.round(p.settlePower*100)}% and settle for 2 seconds.`:'Keep straight with Q / E, set power below 20% and hold B (or Brake) to slow below 6 kt for 2 seconds.'}</li></ol><p class="dialog-note">Manual control from the start. Assist remains available. ${h?(p.contact==='wheels'?'Wheeled landing gear is fixed; nothing to lower and no flaps.':'Skids are fixed; no gear or flaps required.'):'Use the first chartreuse zone; leaving the runway or overrunning ends the attempt.'} R retries this mission. Weather presets are visual only; the wind above moves the aircraft as it flies. Aircraft and runway performance use the existing arcade model.</p><button class="primary-btn" id="start-landing">${h?'Start precision landing':'Start final approach'} <i data-lucide="arrow-up-right"></i></button>`
 :`<p class="mission-caution unavailable" role="note"><i data-lucide="triangle-alert"></i><span>No scored landing here: the ${name} ${fit.reason.toLowerCase()}, and ${f.name} has ${f.runwayLength.toLocaleString('en')} × ${f.runwayWidth} m ${surfaceName(f)}.</span></p><p>Fly this mission at a field that suits it, or choose a lighter aircraft in Explore. You can still depart from ${f.name} in free flight.</p>${fit.alternatives.map(id=>{const a=AIRPORTS.find(x=>x.id===id);return`<button class="secondary-btn" data-mission-airport="${id}">Land at ${a.name} instead <i data-lucide="arrow-up-right"></i></button>`;}).join('')}<button class="primary-btn" data-next-dialog="explore">Choose another aircraft or field <i data-lucide="arrow-up-right"></i></button>`)+`</div>`;
 }else if(type==='course'){
 const c=course.course,fit=courseAvailability(flight.type),name=flight.type.name,rec=aircraftType(RECOMMENDED_AIRCRAFT),cruise=Math.round(flight.type.flight.cruiseSpeed*1.94384);
 const recommend=flight.type.id===RECOMMENDED_AIRCRAFT?`<p>The ${rec.name} is the recommended aircraft: forgiving, and slow enough to line up each gate.</p>`:`<p class="mission-caution"><i data-lucide="plane"></i><span>Recommended for a first run: the ${rec.name}, forgiving at about 100 kt. You fly the ${name} unless you switch.</span></p><button class="secondary-btn" data-course-aircraft="${rec.id}">Switch to the ${rec.name} <i data-lucide="plane"></i></button>`;
 const fast=fit.available&&cruise>210?`<p class="mission-caution"><i data-lucide="triangle-alert"></i><span>The ${name} cruises at ${cruise} kt. Ease power to below 210 kt (Ctrl) to make the turns between gates.</span></p>`:'';
 content=dialogHead(c.name)+`<div class="dialog-body landing-brief"><span class="landing-eyebrow">Checkpoint course · ${c.gates.length} gates · ${(c.length/1000).toFixed(1)} km · ${region(c.region).name}</span><h3>${name}</h3>`+(fit.available?`<p>Begin in the air at the south end of Lake Azure, lined up with gate 1, with flight assist holding you level. Fly the ${c.gates.length} gates north up the lake, past Alpine Field. The next gate is chartreuse; later ones are ivory.</p>${recommend}${fast}<ol><li>Fly through each gate's opening from the front. Around, over, under or backwards does not count.</li><li>Gates count only in order. The card names the next gate, its distance and which way to turn.</li><li>The clock runs on flight time: pausing or opening a dialog stops it. A crash ends the run; R or Retry starts again from the beginning.</li></ol><p class="dialog-note">Your best time is kept for this session only. Starting a landing mission ends the course; landing missions keep their own starts and scoring. Changing aircraft cancels the run.</p><button class="primary-btn" id="start-course">Start the course <i data-lucide="arrow-up-right"></i></button>`
 :`<p class="mission-caution unavailable" role="note"><i data-lucide="triangle-alert"></i><span>No course run in the ${name}: ${fit.reason.toLowerCase()}.</span></p><p>Choose a fixed-wing aircraft to fly the gates. Your helicopter stays selected until you change it.</p><button class="secondary-btn" data-course-aircraft="${rec.id}">Switch to the ${rec.name} <i data-lucide="plane"></i></button><button class="primary-btn" data-next-dialog="explore">Choose another aircraft <i data-lucide="arrow-up-right"></i></button>`)+`</div>`;
 }else if(type==='crosswind'){
 const fit=practiceAvailability(flight.type),b=practiceBrief(flight.type),f=b.field,name=flight.type.name,rec=aircraftType(PRACTICE.recommended);
 const into=b.side==='right'?'E':'Q',back=b.side==='right'?'Q':'E',bank=b.side==='right'?'D':'A',away=b.side==='right'?'left':'right';
 const recommend=flight.type.id===PRACTICE.recommended?`<p>The ${rec.name} is the recommended aircraft: slow, so the crab is easy to see and there is time to set it.</p>`:`<p class="mission-caution"><i data-lucide="plane"></i><span>Recommended for a first try: the ${rec.name}, slow enough to see the crab and set it. You fly the ${name} unless you switch.</span></p><button class="secondary-btn" data-crosswind-aircraft="${rec.id}">Switch to the ${rec.name} <i data-lucide="plane"></i></button>`;
 content=dialogHead(PRACTICE.name)+`<div class="dialog-body landing-brief"><span class="landing-eyebrow">Crosswind practice · ${f.name} · runway ${f.runway} · heading ${headingDegrees(f.heading)}°</span><h3>${name}</h3>`+(fit.available?`<p>The landing mission's approach to runway ${f.runway}, in a fixed wind set for the attempt. Begin lined up on a 3° final 1.1 km out with ${flight.type.fixedGear?'fixed gear':'gear down'}${flight.type.noFlaps?'':' and full flaps'}; touchdown and rollout are scored exactly as in the landing mission. Your own wind choice and destination return when the practice ends.</p><dl class="landing-metrics crosswind-brief"><div><dt>Wind</dt><dd>${b.report.replace(' kt','')} <small>kt</small></dd></div><div><dt>Crosswind</dt><dd>${knots(b.crosswind)} <small>kt from the ${b.side}, gusts ${knots(b.gustCrosswind)}</small></dd></div><div><dt>Headwind</dt><dd>${knots(b.headwind)} <small>kt</small></dd></div><div><dt>Crab at ${knots(b.speed)} kt</dt><dd>${wholeDegrees(b.crab)}<small>° ${b.side}</small></dd></div></dl>${recommend}<ol><li>Crab into the wind. Left alone, the wind carries you ${away} of the centreline. Turn about ${wholeDegrees(b.crab)}° ${b.side} with ${into}, or a gentle bank with ${bank} or the touch yoke, until the runway stops sliding sideways: the nose points ${b.side} of the runway while you track straight down it. The card shows which way you drift; the flight-path marker (Settings) shows where you are really going.</li><li>Flare, then straighten. Flare as in the landing mission with the crab still in; about 10 ft up, press ${back} to yaw the nose in line with the runway and hold the flare. In this simplified model the drift stops when the wheels touch, so straighten late and quickly. Touch down with wings level, within 12° of the runway: on a phone, without rudder, level the wings and flare with the crab still in.</li><li>Roll out as in the landing mission: idle power, hold B or Brake, and steer straight with Q / E or the yoke. Pausing or a dialog freezes the wind and the clock; R or Retry flies the same approach in the same gusts.</li></ol><p class="dialog-note">Simplified arcade wind, not real aircraft limits. Starting a landing mission or the checkpoint course, changing aircraft, or Free flight ends the practice.</p><button class="primary-btn" id="start-crosswind">Start crosswind practice <i data-lucide="arrow-up-right"></i></button>`
 :`<p class="mission-caution unavailable" role="note"><i data-lucide="triangle-alert"></i><span>No crosswind practice in the ${name}: ${fit.reason.charAt(0).toLowerCase()+fit.reason.slice(1)}.</span></p><p>Choose a fixed-wing aircraft that suits ${f.name}. The ${name} stays selected until you change it.</p><button class="secondary-btn" data-crosswind-aircraft="${rec.id}">Switch to the ${rec.name} <i data-lucide="plane"></i></button><button class="primary-btn" data-next-dialog="explore">Choose another aircraft <i data-lucide="arrow-up-right"></i></button>`)+`</div>`;
 }else if(type==='recovery'){
 const fit=recoveryAvailability(flight.type),name=flight.type.name,rec=aircraftType(RECOVERY.aircraft);
 content=dialogHead('Recover from a stall')+`<div class="dialog-body landing-brief"><span class="landing-eyebrow">Stall recovery · Mira T2 · calm air · manual flight</span><h3>${name}</h3>`+(fit.available?`<p>A repeatable exercise for the ${rec.name}. Start wings level at 82 kt, about 5,900 ft above sea level over the lake, with fixed gear, flaps retracted and neutral trim. Your wind returns when you leave; your destination stays selected.</p><ol><li>Slow down. Hold Ctrl (− on a phone) to idle power; keep wings level and the nose near the horizon. Wait for the STALL warning, usually near 49 kt in this clean setup. Flying slowly alone does not count.</li><li>Recover. Gently lower the nose below the horizon with W / ↑ (push the yoke forward), and add power with Shift / + to at least 80%. Let airspeed build to 68 kt before easing back toward the horizon with S / ↓ or the yoke.</li><li>Stabilize for 3 continuous seconds: 68–107 kt, nose within 3° of the horizon, wings within 5° of level and vertical speed within ±400 ft/min. Keep power at 80% or more; ease toward 80% if too fast. The card shows your nose attitude and stable time.</li></ol><p class="dialog-note">Manual control throughout; engaging assist ends this attempt. Keep flaps retracted. A crash, ground contact, less than 150 m terrain clearance, 250 m (820 ft) of height loss from the start, no stall within 60 seconds or no stable recovery within 45 seconds after the stall ends it. R / Retry repeats the setup; Free flight restores your wind. Pause, dialogs and a hidden tab stop the flight clock.</p><p class="dialog-note">Measures time from the first recorded stall to stable flight, and maximum height lost below the stall altitude. Simplified arcade practice, not certified flight training or proof of real-world technique.</p><button class="primary-btn" id="start-recovery">Start Mira T2 stall recovery <i data-lucide="arrow-up-right"></i></button>`:`<p class="mission-caution unavailable" role="note"><i data-lucide="triangle-alert"></i><span>No scored stall recovery in the ${name}. ${fit.reason}.</span></p><p>Your ${name} stays selected until you switch. This exercise uses the ${rec.name}’s clean configuration, controls and measured targets.</p><button class="secondary-btn" id="recovery-aircraft">Switch to the ${rec.name} <i data-lucide="plane"></i></button><button class="primary-btn" data-next-dialog="explore">Back to Explore <i data-lucide="arrow-up-right"></i></button>`)+`</div>`;
 }else if(type==='appearance'){
 content=paintEditor.markup();
 }else if(type==='explore'){
 const sel=selection.airport;
 content=dialogHead('A world above it all')+`<div class="dialog-body"><div class="explore-hero"><svg viewBox="0 0 420 140" aria-label="Alpine mountains"><rect width="420" height="140" fill="hsl(197 30% 66%)"/><path d="M0 98 65 25 92 56 155 9 212 88 270 17 352 102 390 48 420 85v55H0" fill="hsl(205 17% 44%)"/><path d="m65 25-27 30 18-5 11 9 8-18 17 15Zm90-16-39 48 29-14 17 9 14-13 36 49Zm115 8-26 32 17-4 12 13 12-10 25 15Z" fill="hsl(195 20% 91%)"/><path d="M0 109 91 69 177 123 271 72 420 112v28H0" fill="hsl(162 18% 29%)"/><path d="M0 140 168 113 252 117 342 140" fill="hsl(182 42% 42%)"/></svg></div><div class="explore-name"><h3>The Swiss Alps</h3><span>FREE FLIGHT</span></div><p class="explore-description">A winding turquoise lake. Snow-covered ridgelines. Quiet villages tucked into the mountains. Explore our original world inspired by Switzerland's Bernese Oberland.</p><div class="aircraft-appearance-entry"><div><span>Selected aircraft</span><strong>${flight.type.name}</strong></div><button id="customize-aircraft">Customize appearance <i data-lucide="arrow-up-right"></i></button></div><h3 class="dialog-section-title fleet-heading">Aircraft <span>${Object.keys(FLEET).length} to fly · scroll to explore</span></h3><div class="weather-options aircraft-options" role="radiogroup" aria-label="Aircraft">${Object.values(FLEET).map(t=>`<button class="weather-option ${t.id===flight.type.id?'selected':''}" role="radio" tabindex="${t.id===flight.type.id?0:-1}" aria-checked="${t.id===flight.type.id}" data-aircraft="${t.id}"><i data-lucide="plane"></i><div><strong>${t.name} <small>${t.badge}</small></strong><span>${t.choice}</span></div><span></span></button>`).join('')}</div><p class="dialog-note">Changing aircraft saves this flight and starts the new one in the air.</p><h3 class="dialog-section-title fleet-heading" id="airport-heading">Airfield <span>${AIRPORTS.length} fields · fit for the ${flight.type.name}</span></h3><div class="weather-options airport-options" role="radiogroup" aria-labelledby="airport-heading">${AIRPORTS.map(airportOption).join('')}</div>${airportDetail()}<button class="primary-btn" id="explore-landing">Land at ${sel.name} · ${selection.runway} <i data-lucide="arrow-up-right"></i></button><button class="primary-btn" id="explore-start">Start in the air <i data-lucide="arrow-up-right"></i></button><button class="secondary-btn" id="explore-course">Checkpoint course · ${course.course.name} <i data-lucide="arrow-up-right"></i></button><button class="secondary-btn" id="explore-crosswind">${PRACTICE.name} · Alpine Field 36 <i data-lucide="arrow-up-right"></i></button><button class="secondary-btn" id="explore-recovery">Stall recovery · Mira T2 <i data-lucide="arrow-up-right"></i></button><button class="secondary-btn" id="runway-start">${heli?'Lift off from':'Depart'} ${sel.name} · runway ${selection.runway} <i data-lucide="plane"></i></button><button class="secondary-btn" data-next-dialog="chart">See ${sel.name} on the navigation chart <i data-lucide="map"></i></button><p class="dialog-note">Original procedural scenery and aircraft. An accessible flight experience with an arcade flight model.</p></div>`;
 }else if(type==='chart'){
 content=dialogHead('Navigation chart')+`<div class="dialog-body chart-body"><div class="chart-map"><canvas id="chart-canvas" tabindex="0" role="img" aria-describedby="chart-help"></canvas><span class="map-north" aria-hidden="true">N <span>↑</span></span></div><div class="chart-side"><div class="chart-readout" id="chart-readout" aria-live="polite"></div><div class="chart-tools"><div class="chart-framing" role="radiogroup" aria-label="Chart framing">${FRAMINGS.map(f=>`<button role="radio" data-framing="${f}">${FRAMING_LABELS[f]}</button>`).join('')}</div><div class="chart-zoom"><button id="chart-zoom-out" aria-label="Zoom chart out"><i data-lucide="minus"></i></button><button id="chart-zoom-in" aria-label="Zoom chart in"><i data-lucide="plus"></i></button></div></div><h3 class="dialog-section-title">Destination</h3><div class="chart-airports" role="radiogroup" aria-label="Destination airfield">${AIRPORTS.map(chartAirport).join('')}</div><p class="dialog-note" id="chart-help">Choose the destination here or on the map; selection matches Explore. Track and groundspeed measure ground travel. The estimate projects present closing speed from the paused flight state; it does not predict landing time. Drag / arrows pan; + / − zoom.</p><button class="secondary-btn" data-next-dialog="explore">Departures and landing missions <i data-lucide="arrow-up-right"></i></button></div></div>`;
 }else if(type==='logbook'){
 if(landingHistory.persisted===false)landingHistory.flush();
 const {time:totalTime,distance:totalDistance}=flightTotals(savedFlights,{time:flight.state.flightTime,distance:flight.state.distance});
 content=dialogHead('Every flight is a story')+`<div class="dialog-body"><p>Your time in the skies, saved on this browser.</p><div class="log-stats"><div class="log-stat"><span>Total flight time</span><strong>${formatTime(totalTime)}</strong></div><div class="log-stat"><span>Distance explored</span><strong>${(totalDistance/1852).toFixed(1)} <span>NM</span></strong></div></div><h3 class="dialog-section-title">Current flight</h3><div class="log-row"><span>The Swiss Alps · ${flight.type.name}</span><strong>${formatTime(flight.state.flightTime)}</strong></div><h3 class="dialog-section-title">Previous flights</h3>${savedFlights.length?savedFlights.slice(0,5).map(f=>`<div class="log-row"><span>${formatFlightDate(f.date)}${f.aircraft?` · ${aircraftType(f.aircraft).name}`:''} · ${(f.distance/1852).toFixed(1)} NM</span><strong>${formatTime(f.time)}</strong></div>`).join(''):'<div class="empty-log">Your adventure is just beginning. Flights are saved when you restart or leave the simulator.</div>'}${landingHistoryMarkup(landingHistory)}</div>`;
 }
 $('dialog-content').innerHTML=content;dialog.classList.toggle('logbook-dialog',type==='logbook');dialog.classList.toggle('chart-dialog',type==='chart');dialog.classList.toggle('settings-dialog',type==='settings');dialog.classList.toggle('recovery-dialog',type==='recovery');dialog.classList.toggle('paint-dialog',type==='appearance');if(type==='appearance')dialog.setAttribute('aria-labelledby','paint-title');else dialog.removeAttribute('aria-labelledby');if(type!=='chart')chartMap=null;
 refreshIcons();if(!dialog.open)dialog.showModal();
 if(type==='recovery'){dialog.scrollTop=0;dialog.querySelector('[data-close]').focus({preventScroll:true});}
 dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dialog.close());dialog.querySelectorAll('[data-next-dialog]').forEach(b=>b.onclick=()=>showDialog(b.dataset.nextDialog));
 dialog.querySelectorAll('[data-weather]').forEach(b=>b.onclick=()=>{setWeather(b.dataset.weather);showDialog('environment');});
 if(type==='environment'){dialog.querySelectorAll('[data-wind]').forEach(b=>b.onclick=()=>{if(setWind(b.dataset.wind)){showDialog('environment');dialog.querySelector(`[data-wind="${b.dataset.wind}"]`)?.focus();}});radioKeys('[data-wind]');}
 if(type==='settings'){
 $('graphics-quality').onchange=e=>setQuality(e.target.value);
 $('setting-assist').onclick=e=>{flight.toggleAutopilot();e.currentTarget.setAttribute('aria-checked',flight.state.autopilot);updateAssist();};
 for(const [id,key] of [['setting-invert','invertPitch'],['setting-mouse','mouseSteering']])$(id).onclick=e=>{settings[key]=!settings[key];clearControls();e.currentTarget.setAttribute('aria-checked',settings[key]);saveSettings();};
 $('setting-map').onclick=e=>{toggleMap();e.currentTarget.setAttribute('aria-checked',settings.showMap);};
 for(const [id,key] of [['setting-hud','showHud'],['setting-instruments','showInstruments'],['setting-hints','showHints'],['setting-crosshair','showCrosshair'],['setting-flight-path','showFlightPath']])$(id).onclick=e=>{settings[key]=!settings[key];applyDisplay();saveSettings();e.currentTarget.setAttribute('aria-checked',settings[key]);};
 for(const axis of ['pitch','roll','yaw','throttle'])bindSlider(`response-${axis}`,v=>{settings.response[axis]=v;controls.setResponse(settings.response);});
 bindSlider('chase-distance',v=>{settings.chaseDistance=v;sceneDirty=true;});
 bindSlider('master-volume',v=>{settings.volume=v;audio.setVolume(v);});
 dialog.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{setView(b.dataset.view,false);dialog.querySelectorAll('[data-view]').forEach(o=>{const on=o.dataset.view===view;o.setAttribute('aria-checked',on);o.tabIndex=on?0:-1;});});radioKeys('[data-view]');
 $('setting-sound').onclick=async e=>{const b=e.currentTarget;await setSound(settings.muted);b.setAttribute('aria-checked',!settings.muted);};
 $('restore-defaults').onclick=restoreDefaults;
 }
 if(type==='appearance'){dialog.scrollTop=0;paintEditor.mount($('dialog-content'));}
 if(type==='logbook'){dialog.scrollTop=0;mountLandingHistory($('dialog-content'),landingHistory);}
 if(type==='chart')setupChart();
 if(type==='landing'){if($('start-landing'))$('start-landing').onclick=()=>{if(startLanding(selection.field))dialog.close();};dialog.querySelectorAll('[data-mission-airport]').forEach(b=>b.onclick=()=>{selection.select(b.dataset.missionAirport);showDialog('landing');$('start-landing')?.focus();});}
 if(type==='course'){$('start-course')&&($('start-course').onclick=()=>{if(startCourse())dialog.close();});dialog.querySelectorAll('[data-course-aircraft]').forEach(b=>b.onclick=()=>{setAircraft(b.dataset.courseAircraft);showDialog('course');$('start-course')?.focus();});}
 if(type==='recovery'){if($('start-recovery'))$('start-recovery').onclick=()=>{if(startRecovery())dialog.close();};if($('recovery-aircraft'))$('recovery-aircraft').onclick=()=>{setAircraft(RECOVERY.aircraft);showDialog('recovery');};}
 if(type==='crosswind'){$('start-crosswind')&&($('start-crosswind').onclick=()=>{if(startCrosswind())dialog.close();});dialog.querySelectorAll('[data-crosswind-aircraft]').forEach(b=>b.onclick=()=>{setAircraft(b.dataset.crosswindAircraft);showDialog('crosswind');$('start-crosswind')?.focus();});}
 if(type==='explore'){
 $('customize-aircraft').onclick=()=>showDialog('appearance');
 $('explore-landing').onclick=()=>showDialog('landing');$('explore-course').onclick=()=>showDialog('course');$('explore-crosswind').onclick=()=>showDialog('crosswind');$('explore-recovery').onclick=()=>showDialog('recovery');$('explore-start').onclick=()=>{cancelLanding(false);restart();dialog.close();};$('runway-start').onclick=()=>{runwayStart();dialog.close();};
 radioKeys('[data-aircraft]');radioKeys('[data-airport]');radioKeys('[data-runway]');
 dialog.querySelectorAll('[data-aircraft]').forEach(b=>b.onclick=()=>{if(setAircraft(b.dataset.aircraft))rerenderExplore(`[data-aircraft="${b.dataset.aircraft}"]`);});
 // Choosing a field or runway only changes the selection; departures and missions start from the buttons.
 dialog.querySelectorAll('[data-airport]').forEach(b=>b.onclick=()=>{if(selection.select(b.dataset.airport))rerenderExplore(`[data-airport="${b.dataset.airport}"]`);});
 dialog.querySelectorAll('[data-runway]').forEach(b=>b.onclick=()=>{if(selection.select(selection.id,b.dataset.runway))rerenderExplore(`[data-runway="${b.dataset.runway}"]`);});
 }
 // The wind suggestion is applied only here, by the pilot: it selects the other runway and changes nothing else.
 dialog.querySelectorAll('[data-apply-runway]').forEach(b=>b.onclick=()=>{if(!applyAdvice(selection,runwayAdvice()))return;toast(`Runway ${selection.runway} selected · into wind`);
  if(type==='explore')rerenderExplore(`[data-runway="${selection.runway}"]`);else{showDialog(type);$('start-landing')?.focus();}});
}
document.querySelectorAll('[data-dialog]').forEach(b=>b.onclick=()=>showDialog(b.dataset.dialog));
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
function formatTime(t){const h=Math.floor(t/3600);return`${h?String(h).padStart(2,'0')+':':''}${String(Math.floor(t/60)%60).padStart(2,'0')}:${String(Math.floor(t)%60).padStart(2,'0')}`;}
const handledKeys=['KeyB','BracketLeft','BracketRight','KeyT','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','ControlLeft','ControlRight','KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE','KeyP','KeyC','KeyG','KeyF','KeyM','KeyH','KeyR','KeyN','KeyV','Minus','Equal','NumpadSubtract','NumpadAdd'];
window.addEventListener('keydown',e=>{
 if(dialog.open||e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;
 if(handledKeys.includes(e.code))e.preventDefault();
 if(e.repeat)return;
 if(!paused&&!flight.state.crashed){keys.add(e.code);queueControls(e.timeStamp/1000);}
 ({KeyP:()=>setPaused(!paused),Space:toggleAssist,KeyC:cycleView,KeyG:gear,KeyF:flaps,KeyM:toggleMap,KeyH:toggleHud,KeyR:()=>restart(),KeyT:resetTrim,KeyN:()=>showDialog('chart'),KeyV:cycleMapFraming,Minus:()=>zoomMap(-1),NumpadSubtract:()=>zoomMap(-1),Equal:()=>zoomMap(1),NumpadAdd:()=>zoomMap(1)})[e.code]?.();
});
window.addEventListener('keyup',e=>{if(dialog.open)return;const trimming=(e.code==='BracketLeft'||e.code==='BracketRight')&&keys.has(e.code);keys.delete(e.code);queueControls(e.timeStamp/1000);if(trimming&&hasPitchTrim(flight.type))toast(`Pitch trim ${trimText(flight.state.pitchTrim)}`);});window.addEventListener('blur',clearControls);
document.addEventListener('visibilitychange',()=>{clearControls();altitudeReminder.update(flight.state,{suspended:true,finished:activities.finished});});
let orbitDrag=null;
worldContainer.addEventListener('pointerdown',e=>{if(dialog.open||paused||flight.state.crashed)return;worldContainer.focus();if(view==='orbit'){orbitDrag={x:e.clientX,y:e.clientY};worldContainer.setPointerCapture(e.pointerId);}else if(settings.mouseSteering){mouse.active=true;worldContainer.setPointerCapture(e.pointerId);}});
worldContainer.addEventListener('pointermove',e=>{if(orbitDrag){sceneDirty=true;orbitAngle-=(e.clientX-orbitDrag.x)*.008;orbitHeight=THREE.MathUtils.clamp(orbitHeight+(e.clientY-orbitDrag.y)*.09,-8,35);orbitDrag={x:e.clientX,y:e.clientY};}else if(mouse.active){const r=worldContainer.getBoundingClientRect();mouse.roll=THREE.MathUtils.clamp((e.clientX-r.left-r.width/2)/(r.width*.3),-1,1);mouse.pitch=THREE.MathUtils.clamp((flight.type.flight.rotorcraft?1:-1)*(e.clientY-r.top-r.height/2)/(r.height*.3),-1,1);queueControls(e.timeStamp/1000);}});
const stopPointer=e=>{orbitDrag=null;mouse.active=false;mouse.pitch=0;mouse.roll=0;queueControls(e.timeStamp/1000);};worldContainer.addEventListener('pointerup',stopPointer);worldContainer.addEventListener('pointercancel',stopPointer);worldContainer.addEventListener('lostpointercapture',stopPointer);
worldContainer.addEventListener('wheel',e=>{if(view==='orbit'){e.preventDefault();sceneDirty=true;orbitDistance=THREE.MathUtils.clamp(orbitDistance+e.deltaY*.025,18,85);}},{passive:false});
const yoke=$('touch-yoke'),knob=$('yoke-knob');let yokeId=null;
function yokeMove(e){const r=yoke.getBoundingClientRect(),dx=THREE.MathUtils.clamp((e.clientX-r.left-r.width/2)/39,-1,1),dy=THREE.MathUtils.clamp((e.clientY-r.top-r.height/2)/39,-1,1);touch.roll=dx;touch.pitch=flight.type.flight.rotorcraft?dy:-dy;knob.style.transform=`translate(${dx*29}px,${dy*29}px)`;queueControls(e.timeStamp/1000);}
yoke.addEventListener('pointerdown',e=>{e.preventDefault();if(yokeId!==null||paused||dialog.open||flight.state.crashed)return;yokeId=e.pointerId;yoke.setPointerCapture(e.pointerId);yokeMove(e);});yoke.addEventListener('pointermove',e=>{if(e.pointerId===yokeId)yokeMove(e);});
function resetYoke(e){yokeId=null;touch.pitch=0;touch.roll=0;knob.style.transform='';queueControls(e?e.timeStamp/1000:undefined);}for(const event of ['pointerup','pointercancel','lostpointercapture'])yoke.addEventListener(event,e=>{if(e.pointerId===yokeId)resetYoke(e);});
for(const [id,v]of [['throttle-up',1],['throttle-down',-1]]){
 const b=$(id),sync=e=>{touch.throttle=THREE.MathUtils.clamp([...throttlePointers.values()].reduce((a,b)=>a+b,0),-1,1);queueControls(e.timeStamp/1000);};
 b.onpointerdown=e=>{e.preventDefault();if(paused||dialog.open||flight.state.crashed)return;b.setPointerCapture(e.pointerId);throttlePointers.set(e.pointerId,v);sync(e);};
 for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,e=>{throttlePointers.delete(e.pointerId);sync(e);});
}

// Separate pointers allow cyclic, collective and yaw to be used together on a phone.
for(const [id,v] of [['yaw-left',-1],['yaw-right',1]]){
 const b=$(id),sync=e=>{touch.yaw=THREE.MathUtils.clamp([...yawPointers.values()].reduce((a,b)=>a+b,0),-1,1);queueControls(e.timeStamp/1000);};
 b.onpointerdown=e=>{e.preventDefault();if(paused||dialog.open||flight.state.crashed)return;b.setPointerCapture(e.pointerId);yawPointers.set(e.pointerId,v);sync(e);};
 for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,e=>{yawPointers.delete(e.pointerId);sync(e);});
}

// Hold-to-brake: any finger on the button holds the wheel brakes; lifting, cancelling or losing it releases them.
{
 const b=$('touch-brake'),sync=e=>{touch.brake=brakePointers.size?1:0;b.classList.toggle('active',!!touch.brake);b.setAttribute('aria-pressed',!!touch.brake);queueControls(e.timeStamp/1000);};
 b.onpointerdown=e=>{e.preventDefault();if(paused||dialog.open||flight.state.crashed||flight.type.flight.rotorcraft)return;b.setPointerCapture(e.pointerId);brakePointers.add(e.pointerId);sync(e);};
 for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,e=>{brakePointers.delete(e.pointerId);sync(e);});
 b.addEventListener('contextmenu',e=>e.preventDefault());
}

// Hold-to-trim: a finger on ▲ turns the trim wheel nose up, ▼ nose down, at the trim's fixed rate; lifting, cancelling
// or losing the pointer stops it where it is. The value between them is the readout and resets to neutral.
for(const [id,v] of [['trim-up',1],['trim-down',-1]]){
 const b=$(id),sync=e=>{touch.trim=THREE.MathUtils.clamp([...trimPointers.values()].reduce((a,b)=>a+b,0),-1,1);b.classList.toggle('active',[...trimPointers.values()].includes(v));queueControls(e.timeStamp/1000);};
 b.onpointerdown=e=>{e.preventDefault();if(paused||dialog.open||flight.state.crashed||!hasPitchTrim(flight.type))return;b.setPointerCapture(e.pointerId);trimPointers.set(e.pointerId,v);sync(e);};
 for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,e=>{trimPointers.delete(e.pointerId);sync(e);});
 b.addEventListener('contextmenu',e=>e.preventDefault());
}

// The navigation map: the world's own height function (as rendering and collisions use), every airport and named
// region, and the route to the destination, which is the mission's field during a mission and the selected field
// otherwise (navigationDestination). It points the way; it never steers or moves the aircraft.
const flightTrail=[];let trailClock=0;const trailOrigin=flight.state.position.clone();
const miniFraming={framing:FRAMINGS.includes(settings.mapFraming)?settings.mapFraming:'route',zoom:THREE.MathUtils.clamp(Number(settings.mapZoom)||3,0,ZOOM_SPANS.length-1)};
const chartFraming={framing:'route',zoom:ZOOM_SPANS.length-1};
miniMap=new NavigationMap($('mini-map'),{heightAt:world.heightAt,compact:true,quality:settings.quality});
let lastNav='',mapDrawMs=0;
const navScene=(framing,budget)=>{const s=flight.state;return{framing,aircraft:{x:s.position.x,z:s.position.z,heading:s.heading},destination:navigationDestination(airportState()),trail:[trailOrigin,...flightTrail],budget};};
// Read-only ground motion comes from the shared flight-path contract, including wind, hover and ground rolls.
const navReadout=()=>navigationReadout({position:flight.state.position,heading:flight.state.heading,groundVelocity:groundVelocity(flight.state,flight.type)},navigationDestination(airportState()));
function setMapFraming(next){Object.assign(miniFraming,next);if(miniFraming.framing!=='free'){settings.mapFraming=miniFraming.framing;settings.mapZoom=miniFraming.zoom;saveSettings();}drawMap();}
function cycleMapFraming(){const i=FRAMINGS.indexOf(miniFraming.framing);setMapFraming({framing:FRAMINGS[(i+1)%FRAMINGS.length]});toast(`Map · ${FRAMING_LABELS[miniFraming.framing].toLowerCase()} view`);}
function zoomMap(direction){if(!settings.showMap)toggleMap();if(miniMap.view)setMapFraming(zoomFrom(miniFraming,miniMap.view,direction));}
function drawMap(){
 if(!settings.showMap)return;
 const t0=performance.now();miniMap.draw(navScene(miniFraming));mapDrawMs=performance.now()-t0;
 const n=navReadout(),d=navigationDestination(airportState());
 const text=`${d?.ident}|${n.bearingText}|${n.distanceText}|${n.trackText}|${n.groundSpeedText}|${miniFraming.framing}|${d?.mission}`;
 $('map-nav-arrow').style.transform=`rotate(${n.relative??0}rad)`;
 if(text!==lastNav){lastNav=text;$('map-nav-ident').textContent=d?d.ident:'—';$('map-nav-bearing').textContent=d?`${n.bearingText}°`:'';$('map-nav-distance').textContent=n.distanceText;$('map-track').textContent=n.trackText;$('map-groundspeed').textContent=n.groundSpeedText;
  $('map-nav').setAttribute('aria-label',d?`${d.mission?'Landing mission at':'Navigate to'} ${d.name}: bearing ${n.bearingText} degrees, ${n.distanceText.replace('NM','nautical miles')}`:'No destination');
  $('map-framing-label').textContent=FRAMING_LABELS[miniFraming.framing];$('map-framing').setAttribute('aria-label',`Map framing: ${FRAMING_LABELS[miniFraming.framing]}. Change framing`);
  $('mini-map').setAttribute('aria-label',d?`Navigation map, ${FRAMING_LABELS[miniFraming.framing].toLowerCase()} view: aircraft and ${d.name}`:'Navigation map');}
}
// The live runway wind: the instantaneous sample on the mission's locked runway while one flies, otherwise the
// selected runway, in the map row and the mission card. Text names head/tail and the side; the arrow points downwind.
let lastWindReadout='';
function updateWindReadout(){
 const f=readoutField(selection,landing),r=windReadout(flight.sampleWind(),f),text=`${f.id}|${r.runway}|${r.text}|${r.tone}|${r.arrow===null?'':r.arrow.toFixed(2)}`;
 if(text===lastWindReadout)return;lastWindReadout=text;
 $('map-wind-arrow').style.transform=`rotate(${r.arrow??0}rad)`;$('map-wind-arrow').classList.toggle('calm',r.arrow===null);
 $('map-wind-runway').textContent=`${f.ident} ${r.runway}`;$('map-wind-text').textContent=r.text==='Calm'?'Wind calm':`Now ${r.text}`;$('map-wind-text').className=`wind-${r.tone}`;
 $('map-wind').setAttribute('aria-label',`Wind now on ${f.name} runway ${r.runway}: ${r.words}`);
 $('landing-wind').innerHTML=`<span>Wind now</span> <span class="wind-${r.tone}">${r.text==='Calm'?'calm':r.text}</span>`;$('landing-wind').setAttribute('aria-label',`Wind now on runway ${r.runway}: ${r.words}`);
}
// The airspeed envelope (src/airspeed-envelope.js): read-only bands on the fixed-wing tape, and a latched low / high /
// overspeed state that is off on the ground, after a crash, while paused, under a dialog and once a mission is over.
const airspeedMonitor=new AirspeedMonitor();let lastBands=null,lastAirspeed='';
function updateAirspeed(s,speed,active){
 const e=airspeedEnvelope(flight.type,s.flaps,s),state=airspeedMonitor.update(s,flight.type,active),bands=e?`${flight.type.id}|${e.stall}`:'';
 $('speed-marker').style.left=`${e?tapeLayout(e,speed).marker:Math.min(96,speed/flight.type.speedScale*100)}%`;
 if(bands!==lastBands){lastBands=bands;const t=e&&tapeLayout(e,0),band=(id,from,to)=>{const b=$(id);b.hidden=!e;if(e){b.style.left=`${from}%`;b.style.width=`${to-from}%`;}};
  band('band-stall',0,t?.stall);band('band-low',t?.stall,t?.low);band('band-caution',t?.caution,t?.overspeed);band('band-over',t?.overspeed,100);}
 if(state!==lastAirspeed){lastAirspeed=state;$('airspeed-label').textContent=AIRSPEED_LABELS[state];const c=$('airspeed-instrument').classList;for(const k of ['low','high','overspeed'])c.toggle(k,state===k);}
 return state;
}
// The TERRAIN warning (src/terrain-alert.js): a bounded look-ahead along the actual travel over world.heightAt,
// resampled at most four times a flight second. Read-only; runway approaches and takeoffs at any field stay quiet.
const terrainAlert=new TerrainAlert(world.heightAt);let terrainView=terrainAlert.view();
let lastAssist=true,lastUi=0,lastFps=performance.now(),fpsFrames=0;
function updateUI(time){
 const s=flight.state,h=!!flight.type.flight.rotorcraft;const speed=(s.airspeed??s.speed)*1.94384,alt=s.position.y*3.28084,heading=(s.heading*180/Math.PI+360)%360,vsi=Math.round(s.verticalSpeed*196.85/10)*10;
 $('g-force').textContent=(Math.abs(s.gForce)<0.05?0:s.gForce).toFixed(1);$('g-force-instrument').classList.toggle('overload',s.gForce>6);
 $('speed').textContent=Math.round(speed);$('altitude').textContent=Math.round(alt).toLocaleString();$('agl').textContent=Math.round((s.position.y-world.heightAt(s.position.x,s.position.z))*3.28084).toLocaleString();$('heading').textContent=String(Math.round(heading)%360).padStart(3,'0');$('vertical-speed').textContent=`${vsi>0?'+':''}${vsi}`;$('vertical-state').textContent=Math.abs(vsi)<50?(h&&(groundTrack(s,flight.type)?.speed??0)<.5?'Hovering':'Level flight'):vsi>0?'Climbing':'Descending';$('heading-cardinal').textContent=['N','NE','E','SE','S','SW','W','NW'][Math.round(heading/45)%8];$('throttle-value').textContent=`${Math.round(s.throttle*100)}%${s.afterburner?' · AB':''}`;$('touch-power-label').textContent=h?`Collective ${Math.round(s.throttle*100)}%`:'Power';$('throttle-slider').value=s.throttle*100;$('gear-state').textContent=h||flight.type.fixedGear?'FIXED':s.gearDown?'DOWN':'UP';$('gear-btn').classList.toggle('active',s.gearDown);$('flaps-state').textContent=h||flight.type.noFlaps?'N/A':`${s.flaps*15}°`;$('flaps-btn').classList.toggle('active',s.flaps>0);updateTrim();$('flight-timer').textContent=formatTime(s.flightTime);$('map-distance').textContent=`${(s.distance/1852).toFixed(1)} NM`;$('attitude-inner').style.transform=`rotate(${-s.bank*180/Math.PI}deg) translateY(${s.pitch*45}px)`;
 if(lastAssist!==s.autopilot){lastAssist=s.autopilot;updateAssist();}
 updateHeadingBug();
 $('gear-warning').hidden=!flight.gearWarning||activities.finished;
 const stalled=s.stalled&&!activities.finished&&!s.grounded&&!s.crashed&&!paused&&!dialog.open;
 const overspeed=updateAirspeed(s,speed,!paused&&!dialog.open&&!activities.finished)==='overspeed';
 const terrain=terrainView=terrainAlert.update(s,flight.type,activities.finished);
 const reminder=altitudeReminder.update(s,{suspended:paused||dialog.open||document.hidden,finished:activities.finished});
 const reminderNotice=altitudeReminderNotice(reminder);altitudeControls?.refresh();
 let notice='';if(stalled)notice='STALL · Add power and regain airspeed';else if(terrain.level!=='clear')notice=terrainNotice(terrain.level,h);else if(overspeed)notice=OVERSPEED_NOTICE;else if(reminderNotice)notice=reminderNotice;else if(s.grounded&&!h&&s.brake>0.02)notice='Wheel brakes on · release to roll';else if(s.grounded&&landing.status==='idle')notice=h?'On the ground · Raise collective to lift vertically':'On the ground · Add power and pitch up to take off';
 if(activities.finished)notice='';
 const overspeedShown=notice===OVERSPEED_NOTICE;
 $('altitude-notice-ack').hidden=!reminderNotice||notice!==reminderNotice;
 $('flight-notice').classList.toggle('altitude-notice',!!reminderNotice&&notice===reminderNotice);
 if(notice!==lastNotice){lastNotice=notice;$('flight-notice-text').textContent=notice;$('flight-notice').classList.toggle('visible',!!notice);$('flight-notice').classList.toggle('warning',stalled||terrain.level==='warning'||overspeedShown);$('flight-notice').classList.toggle('caution',!stalled&&terrain.level==='caution');$('flight-notice').classList.toggle('stall',stalled);$('flight-notice').classList.toggle('overspeed',overspeedShown);}
 updateLandingUI();updateWindReadout();
 if(s.crashed&&!lastCrash&&activities.kind==='free'){lastCrash=true;$('crash-overlay').hidden=false;$('sim-status').textContent='Flight ended';}
 drawMap();drawChart();
}
function updateCamera(dt){
 // The touchdown settle is added after aiming and taken off again first, so lagging views never accumulate it.
 camera.position.sub(settleOffset);settleOffset.set(0,0,0);
 const s=flight.state,scale=flight.type.cameraScale??1;horizontalEuler.set(0,-s.heading,0);horizontalQuat.setFromEuler(horizontalEuler);
 const heli=!!flight.type.flight.rotorcraft,free=flight.type.flight.aerobatic,frame=free?(initialCamera?followFrame.reset(s.quaternion):followFrame.update(s.quaternion,dt,s.bodyRates.pitch)):horizontalQuat;
 camera.up.set(0,1,0);if(free)camera.up.applyQuaternion(frame);
 if(view==='cockpit'){
  cockpit.userData.fit?.(camera.aspect);
  offset.fromArray(flight.type.cockpitOffset??[0,heli?0.65:1.05,heli?-1.25:-1.8]).applyQuaternion(s.quaternion);camera.position.copy(s.position).add(offset);camera.quaternion.copy(s.quaternion);camera.fov=67;
 }else{
  if(view==='orbit')offset.set(Math.sin(orbitAngle)*orbitDistance,orbitHeight,Math.cos(orbitAngle)*orbitDistance).multiplyScalar(scale*(heli?1:THREE.MathUtils.clamp(1.2/camera.aspect,1,2.3)));
  else {const portraitFactor=THREE.MathUtils.clamp(1.2/camera.aspect,1,2.3);offset.set(0,(heli?6.2:8.3)*portraitFactor,(heli?19:23)*portraitFactor).multiplyScalar(scale*settings.chaseDistance);}
  offset.applyQuaternion(frame);cameraPosition.copy(s.position).add(offset);
  // Chase stays on the heading centerline; world-space lag drifts sideways in turns.
  if(view==='chase')camera.position.copy(cameraPosition);
  else camera.position.lerp(cameraPosition,initialCamera?1:1-Math.exp(-dt*4));
  if(view==='orbit'&&s.grounded)camera.position.y=Math.max(camera.position.y,world.heightAt(camera.position.x,camera.position.z)+1.3);
  target.set(0,view==='orbit'?0:-.1,view==='orbit'?0:-(heli?1.5:8)*scale*THREE.MathUtils.clamp(1.2/camera.aspect,1,2.3)).applyQuaternion(frame).add(s.position);camera.lookAt(target);camera.fov=view==='orbit'?52:53;
 }
 if(settle){
  const t=frameTime-settle.start;
  if(t>=settle.duration)settle=null;
  else{settleOffset.set(0,1,0).applyQuaternion(camera.quaternion).multiplyScalar(impulseShape(t,settle.duration)*(view==='cockpit'?settle.cockpit:settle.outside));camera.position.add(settleOffset);sceneDirty=true;
   if(view==='orbit'&&s.grounded){const floor=world.heightAt(camera.position.x,camera.position.z)+1.3;if(camera.position.y<floor){settleOffset.y+=floor-camera.position.y;camera.position.y=floor;}}}
 }
 camera.updateProjectionMatrix();initialCamera=false;
}
// The flight-path marker (src/flight-path.js): actual travel through the camera just rendered. Read-only; it never
// touches the flight model, and it is hidden rather than pinned to an edge when the path is off screen or too slow.
const flightPath=new FlightPathMarker(),flightPathMarker=$('flight-path-marker');let flightPathView={visible:false,x:0,y:0,reason:'off'},stageWidth=worldContainer.clientWidth,stageHeight=worldContainer.clientHeight;
function updateFlightPath(){
 const m=flightPathView=flightPath.update(flight.state,flight.type,camera,stageWidth,stageHeight,flightPathShown(settings)&&!activities.finished);
 if(m.visible)flightPathMarker.style.transform=`translate(${m.x.toFixed(1)}px,${m.y.toFixed(1)}px)`;
 if(flightPathMarker.hidden===m.visible)flightPathMarker.hidden=!m.visible;
}
// Windsocks read the same sample the flight model uses, on the wind's own clock (frozen with the flight).
const windsockSample={};function windsockWind(){flight.sampleWind(windsockSample);windsockSample.time=flight.wind.time;return windsockSample;}
const clock=new THREE.Clock();
function tick(){
 requestAnimationFrame(tick);const dt=Math.min(clock.getDelta(),.25);frameTime+=dt;
 const canFly=!paused&&!dialog.open&&!document.hidden&&!flight.state.crashed&&!activities.finished;
 if(canFly){
  controls.advance(performance.now()/1000,(step,inputs)=>{if(activities.beforeStep(flight.state))return;flight.update(step,inputs);activities.update(step,flight.state);altitudeReminder.update(flight.state,{finished:activities.finished});});flightMaxAlt=Math.max(flightMaxAlt,flight.state.position.y);
  trailClock+=dt;if(trailClock>1){trailClock=0;flightTrail.push({x:flight.state.position.x,z:flight.state.position.z});if(flightTrail.length>2000)flightTrail.shift();}
 }else controls.reset(performance.now()/1000);
 updateTouchdown();
 aircraft.group.position.copy(flight.state.position);aircraft.group.quaternion.copy(flight.state.quaternion);cockpit.userData.update?.(flight.state);aircraft.update(canFly?dt:flight.type.flight.rotorcraft?0:dt*.15,flight.state.throttle,{...flight.state,time:frameTime});
 if(canFly||sceneDirty||orbitDrag){updateGlideLights();world.update(dt,frameTime,flight.state.position,windsockWind());updateCamera(dt);renderer.render(scene,camera);updateFlightPath();sceneDirty=false;fpsFrames++;}audio.update({...flight.state,stalled:canFly&&flight.state.stalled,throttle:paused||activities.finished?0:flight.state.throttle,speed:paused||activities.finished?0:flight.state.speed,crashed:flight.state.crashed||paused||activities.finished},flight.gearWarning);
 if(dialogType==='appearance'&&dialog.open)paintEditor.render();
 if(frameTime-lastUi>.12){lastUi=frameTime;updateUI(frameTime);}const now=performance.now();if(now-lastFps>1500){if(canFly)$('fps-label').textContent=`${Math.round(fpsFrames/((now-lastFps)/1000))} FPS`;fpsFrames=0;lastFps=now;}
}
function resize(){sceneDirty=true;placeRestore();const w=stageWidth=worldContainer.clientWidth,h=stageHeight=worldContainer.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);initialCamera=true;}
window.addEventListener('resize',resize);
window.addEventListener('beforeunload',()=>{saveFlight();if(landingHistory.persisted===false)landingHistory.flush();});
setView(view,false);updateAircraftLabels();updateAirportUI();updateAssist();updateUI(0);updateCamera(1);renderer.render(scene,camera);updateFlightPath();tick();
setTimeout(()=>{$('loading').classList.add('leaving');setTimeout(()=>$('loading').remove(),750);},500);
// Expose read-only diagnostic snapshots for repeatable rendering and control checks.
window.aeronaut={getEngine:()=>({backend:flight.backend,terrain:numerics()?'webassembly':'javascript'}),getState:()=>({...flight.state,position:flight.state.position.toArray(),quaternion:flight.state.quaternion.toArray(),windVelocity:flight.state.windVelocity.toArray(),groundVelocity:groundTrack(flight.state,flight.type),paused,view,quality:settings.quality,weather:settings.weather,wind:settings.wind}),getWind:()=>flight.windSnapshot(),getRunwayWind:()=>{const f=readoutField(selection,landing);return{advice:runwayAdvice(),readout:{field:f.id,...windReadout(flight.sampleWind(),f)}};},getWindsocks:()=>world.airports.map(a=>({id:a.id,yaw:a.windsock.rotation.y,parentYaw:a.windsock.parent.rotation.y,droop:a.windsock.rotation.z})),setWind:value=>setWind(value),getSettings:()=>structuredClone(settings),getMission:()=>landing.snapshot(),startLanding:()=>startLanding(selection.field),getCourse:()=>({...course.snapshot(),activity:activities.kind,gatesVisible:courseGates.group.visible}),startCourse,startCrosswind,startRecovery,getRecovery:()=>({...recovery.snapshot(),activity:activities.kind}),getPractice:()=>({...practice.snapshot(),activity:activities.kind,live:flight.windSnapshot()}),cancelActivity:()=>cancelLanding(true),getRendererInfo:()=>({...renderer.info.render}),getPaintResources:()=>({geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs.length,materials:(()=>{const m=new Set();aircraft.group.traverse(o=>{for(const v of Array.isArray(o.material)?o.material:o.material?[o.material]:[])m.add(v.uuid);});return [...m];})()}),getAircraftTheme:()=>({id:flight.type.id,...aircraft.paint.theme,roles:[...aircraft.paint.roles],colorsByRole:Object.fromEntries(aircraft.paint.roles.map(r=>[r,aircraft.paint.materials[r].map(m=>({color:m.color.toArray(),vertexColors:m.vertexColors}))]))}),getGlideLights:()=>({...glideLights.indication,field:glideLights.field?.id??null,runway:glideLights.field?.runway??null}),getFlightPath:()=>({...flightPathView,enabled:settings.showFlightPath}),getHeadingSelect:()=>({selected:flight.state.selectedHeading,active:flight.state.autopilot&&flight.state.headingHold,autopilot:flight.state.autopilot,recovering:flight.recovering,heading:flight.state.heading*180/Math.PI,open:!headingSelect.hidden}),getAltitudeReminder:()=>({...altitudeReminder.snapshot(),open:altitudeControls.isOpen(),notice:altitudeReminderNotice(altitudeReminder.snapshot())}),getTerrainAlert:()=>({...terrainView,samples:terrainAlert.samples,probes:terrainAlert.probes}),getTouchdown:()=>({last:lastTouchdown&&{...lastTouchdown},settling:!!settle,offset:settleOffset.length(),reducedMotion:!!reducedMotion?.matches,audio:audio.context?.state??'locked',soundOn:audio.enabled}),reset:restart,setPaused, setQuality,setAircraft,runwayStart:(id,runway)=>runwayStart(id?resolveAirport(id,runway).field:selection.field),approachStart:(id,runway)=>approachStart(id?resolveAirport(id,runway).field:selection.field),airports:()=>world.airports.map(({position,windsock,...field})=>field),getAirport:airportState,getNavigation:()=>{const n=navReadout();return{destination:navigationDestination(airportState()),bearing:n.bearing===null?null:Number(n.bearingText),distance:n.distance,track:n.track,trackText:n.trackText,groundSpeed:n.groundSpeed,groundSpeedText:n.groundSpeedText,closingSpeed:n.closingSpeed,eteSeconds:n.eteSeconds,ete:n.ete,eteState:n.eteState,eteReason:n.eteReason,framing:{...miniFraming},scale:miniMap.scale?.label,pendingTiles:miniMap.pending,drawMs:mapDrawMs};},setMapFraming:(framing,zoom)=>setMapFraming({framing,...(zoom===undefined?{}:{zoom})}),selectAirport:(id,runway)=>selection.select(id,runway),getAircraft:()=>({id:flight.type.id,name:flight.type.name,gearPosition:aircraft.gearPosition,surfaces:aircraft.surfaces,afterburner:aircraft.afterburner})};
if(query.get('start')==='runway')runwayStart();else if(query.get('start')==='approach')approachStart();
