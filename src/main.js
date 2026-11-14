import './style.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/barlow-condensed/400.css';
import '@fontsource/barlow-condensed/500.css';
import * as THREE from 'three';
import { createIcons, Plane, SlidersHorizontal, Maximize, Minimize, VolumeX, Volume2, MapPin, ArrowUpRight, Sun, CloudSun, Cloud, ChevronDown, ChevronsUpDown, Navigation, Video, Camera, Map, Scan, Minus, Plus, CircleDot, RotateCcw, Pause, Play, Keyboard, Move, TriangleAlert, X, Check, Mountain, Compass, Wind, Menu, Maximize2 } from 'lucide';
import { createWorld } from './world.js';
import { createAircraft, createCockpit } from './aircraft.js';
import { FlightController, FlightAudio, FollowFrame } from './flight.js';
import { FLEET, aircraftType } from './fleet.js';
import { FlightInputs } from './controls.js';
import { loadSettings, saveSettings as storeSettings, resetSettings, CUSTOMIZATION_KEYS, anyDisplayHidden, toggleDisplay, RESPONSE, CHASE_DISTANCE, VOLUME, percent } from './settings.js';
import { disposeObject } from './helicopter.js';
import { LandingMission, landingProfile } from './landing-mission.js';
import { runwayPoint } from './airfield.js';
import { AIRPORTS, suitability } from './airports.js';
import { AirportSelection, resolveAirport, missionAvailability, describeField, headingDegrees } from './airport-selection.js';
import { region } from './regions.js';
import { createLandingGuidance } from './landing-guidance.js';
import { NavigationMap } from './nav-map.js';
import { navigationDestination, navigationReadout, bearingDistance, degrees, formatNM, zoomFrom, nearestZoom, FRAMINGS, FRAMING_LABELS, ZOOM_SPANS } from './navigation.js';

const icons = {Plane,SlidersHorizontal,Maximize,Minimize,VolumeX,Volume2,MapPin,ArrowUpRight,Sun,CloudSun,Cloud,ChevronDown,ChevronsUpDown,Navigation,Video,Camera,Map,Scan,Minus,Plus,CircleDot,RotateCcw,Pause,Play,Keyboard,Move,TriangleAlert,X,Check,Mountain,Compass,Wind,Menu,Maximize2};
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
let savedFlights = [];
try { savedFlights = JSON.parse(localStorage.getItem('aeronaut-flights') || '[]'); } catch {}
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
scene.add(aircraft.group);world.reflectSky(aircraft.group);
const flight = new FlightController(world.heightAt, settings.aircraft);
const landing = new LandingMission(selection.field);
const signalProbe=document.createElement('span');signalProbe.style.color='var(--accent)';document.body.appendChild(signalProbe);
const signalColor=getComputedStyle(signalProbe).color;signalProbe.remove();
let landingCues = createLandingGuidance(scene,landing.field,signalColor);
// Cues belong to one field and runway: a mission elsewhere frees them and builds fresh ones.
function setMissionCues(field){if(landingCues.field.id===field.id&&landingCues.field.runway===field.runway)return;landingCues.dispose();landingCues=createLandingGuidance(scene,field,signalColor);}
let missionResultShown=false;
flight.toggleAutopilot();
const audio = new FlightAudio();
let paused=false, view=settings.camera, frameTime=0, orbitAngle=0.45, orbitHeight=9, orbitDistance=31;
const keys=new Set();
const touch={pitch:0,roll:0,yaw:0,throttle:0};
const mouse={pitch:0,roll:0,active:false};
const controls=new FlightInputs(performance.now()/1000,settings.response);
const throttlePointers=new globalThis.Map();
const yawPointers=new globalThis.Map();
// DOM timestamps retain the hold duration when rendering delays delivery of both events.
function queueControls(now=performance.now()/1000){
 const pressed=(...codes)=>codes.some(code=>keys.has(code))?1:0;
 const inputs={pitch:(pressed('KeyS','ArrowDown')-pressed('KeyW','ArrowUp')+touch.pitch+(mouse.active?mouse.pitch:0))*(settings.invertPitch?-1:1),roll:pressed('KeyD','ArrowRight')-pressed('KeyA','ArrowLeft')+touch.roll+(mouse.active?mouse.roll:0),yaw:pressed('KeyE')-pressed('KeyQ')+touch.yaw,throttle:pressed('ShiftLeft','ShiftRight')-pressed('ControlLeft','ControlRight')+touch.throttle};
 // Manual intent disengages assist before the gradual onset, including very short taps.
 if(Math.abs(inputs.pitch)+Math.abs(inputs.roll)+Math.abs(inputs.yaw)>(flight.type.flight.rotorcraft?0.001:0.12)||(flight.type.flight.rotorcraft&&Math.abs(inputs.throttle)>.001))flight.state.autopilot=false;
 controls.set(inputs,now);
}
function clearControls(){
 keys.clear();touch.pitch=touch.roll=touch.yaw=touch.throttle=0;mouse.pitch=mouse.roll=0;mouse.active=false;
 throttlePointers.clear();yawPointers.clear();resetYoke();controls.reset(performance.now()/1000);
}
const cameraPosition=new THREE.Vector3(),target=new THREE.Vector3(),offset=new THREE.Vector3();
const horizontalQuat=new THREE.Quaternion(),horizontalEuler=new THREE.Euler();
// An aerobatic aircraft is followed along its nose, so the outside cameras never flip at the top of a loop.
const followFrame=new FollowFrame();
let initialCamera=true, cockpit=createCockpit(settings.aircraft), toastTimeout, lastNotice='', lastCrash=false, sceneDirty=true;
camera.add(cockpit);cockpit.visible=false;
const weatherData={clear:{label:'Clear skies',icon:'sun',description:'18°C <span class="separator">/</span> Wind 240° at 6 kt',time:'14:32'},golden:{label:'Golden hour',icon:'cloud-sun',description:'16°C <span class="separator">/</span> Wind 220° at 4 kt',time:'18:45'},overcast:{label:'Cloud cover',icon:'cloud',description:'12°C <span class="separator">/</span> Wind 260° at 12 kt',time:'11:20'}};
function setWeather(value,notify=true){
 settings.weather=value;world.setWeather(value);sceneDirty=true;const w=weatherData[value];
 $('weather-label').textContent=w.label;$('weather-description').innerHTML=w.description;$('world-time').textContent=w.time;
 const b=$('weather-btn');b.querySelector('svg').outerHTML=`<i data-lucide="${w.icon}"></i>`;refreshIcons();saveSettings();if(notify)toast(`${w.label} selected`);
}
function setQuality(value){settings.quality=value;renderer.setPixelRatio(Math.min(devicePixelRatio,value==='high'?1.75:value==='medium'?1.2:.85));renderer.shadowMap.enabled=value!=='low';world.setQuality?.(value);miniMap?.setQuality(value);chartMap?.setQuality(value);sceneDirty=true;$('quality-label').textContent=value.charAt(0).toUpperCase()+value.slice(1);saveSettings();}
setWeather(weatherData[settings.weather]?settings.weather:'clear',false);setQuality(settings.quality);
applyDisplay();
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('visible'),3000);}
function iconButton(id,icon){$(id).innerHTML=`<i data-lucide="${icon}"></i>`;refreshIcons();}
function setPaused(value){
 if(flight.state.crashed||landing.finished)return;
 paused=value;sceneDirty=true;$('pause-overlay').hidden=!paused;$('sim-status').textContent=paused?'Simulation paused':'Live simulation';
 $('pause-btn').setAttribute('aria-label',paused?'Resume flight':'Pause flight');iconButton('pause-btn',paused?'play':'pause');
 if(paused)clearControls();
}
function saveFlight(){const s=flight.state;if(s.flightTime<10)return;const entry={date:new Date().toISOString(),time:s.flightTime,distance:s.distance,maxAltitude:flightMaxAlt,aircraft:s.aircraft};savedFlights.unshift(entry);savedFlights=savedFlights.slice(0,20);try{localStorage.setItem('aeronaut-flights',JSON.stringify(savedFlights));}catch{}}
let flightMaxAlt=flight.state.position.y;
function restart(notify=true){if(landing.status!=='idle'){startLanding();return;}saveFlight();flight.reset();flight.toggleAutopilot();flightMaxAlt=flight.state.position.y;flightTrail.length=0;trailOrigin.copy(flight.state.position);sceneDirty=true;paused=false;lastCrash=false;initialCamera=true;clearControls();$('pause-overlay').hidden=true;$('crash-overlay').hidden=true;$('sim-status').textContent='Live simulation';iconButton('pause-btn','pause');updateAssist();if(notify)toast('A fresh start. You have the skies.');}
// Every label that names the aircraft reads from the active fleet type.
// Rotorcraft land on fixed skids unless their type has fixed wheels; hover collective is per type.
const wheeled=t=>t.landingGear==='wheels',hoverPercent=t=>Math.round(t.flight.hoverCollective*100),capital=w=>w[0].toUpperCase()+w.slice(1);
function updateAircraftLabels(){
 const t=flight.type,h=!!t.flight.rotorcraft;$('aircraft-name').textContent=t.name;$('aircraft-type').textContent=`${t.type} · ${t.registration}`;$('aircraft-badge').textContent=t.badge;
 $('throttle-label').textContent=h?'Collective':'Throttle';$('throttle-slider').setAttribute('aria-label',h?'Rotor collective':'Engine throttle');
 $('touch-power-label').textContent=h?'Collective':'Power';$('throttle-up').setAttribute('aria-label',h?'Increase collective':'Increase throttle');$('throttle-down').setAttribute('aria-label',h?'Decrease collective':'Decrease throttle');
 $('touch-yaw').hidden=!h;$('touch-yoke').setAttribute('aria-label',h?'Touch cyclic: forward, backward, left and right':'Touch flight joystick');
 $('gear-btn').disabled=h||!!t.fixedGear;$('flaps-btn').disabled=h||!!t.noFlaps;$('gear-btn').title=h?(wheeled(t)?'Fixed wheeled landing gear · always down':'Fixed landing skids'):t.fixedGear?'Fixed landing gear · always down':'Landing gear (G)';$('flaps-btn').title=h||t.noFlaps?'No flaps on this aircraft':'Flaps (F)';
 $('gear-label').textContent=h&&!wheeled(t)?'Skids':'Gear';$('flaps-label').textContent='Flaps';
 $('world').setAttribute('aria-label',h?'Helicopter world. W/S cyclic forward/backward, A/D lateral cyclic, Q/E yaw, Shift/Control collective, Space hover hold.':'Flight world. Use arrow keys to fly, shift and control for throttle.');
 $('key-hints').innerHTML=h?'<span><kbd>W</kbd><kbd>S</kbd>Cyclic</span><span><kbd>A</kbd><kbd>D</kbd>Lateral</span><span><kbd>Q</kbd><kbd>E</kbd>Yaw</span><span><kbd>⇧</kbd><kbd>Ctrl</kbd>Collective</span><span><kbd>Space</kbd>Hover hold</span>':'<span><kbd>W</kbd><kbd>S</kbd>Pitch</span><span><kbd>A</kbd><kbd>D</kbd>Roll</span><span><kbd>Q</kbd><kbd>E</kbd>Rudder</span><span><kbd>⇧</kbd><kbd>Ctrl</kbd>Throttle</span><span><kbd>P</kbd>Pause</span>';
}
// Switching aircraft saves the current flight, then starts the new type fresh in the air with flight assist on.
function setAircraft(id){
 const type=aircraftType(id);if(type.id===flight.type.id)return false;
 cancelLanding(false);saveFlight();flight.setAircraft(type.id);settings.aircraft=type.id;saveSettings();
 scene.remove(aircraft.group);aircraft.dispose?.();aircraft=createAircraft(type.id);scene.add(aircraft.group);world.reflectSky(aircraft.group);aircraft.setCockpit(view==='cockpit');
 camera.remove(cockpit);disposeObject(cockpit);cockpit=createCockpit(type.id);camera.add(cockpit);cockpit.visible=view==='cockpit';
 restart(false);updateAircraftLabels();toast(`${type.name} ready · a fresh start in the air`);return true;
}
// ?airport=<id>&runway=<nn> selects a field as the picker does; &start=runway or &start=approach begins there.
// Selected airport and mission field for other views (the navigation map): airportState() here, window.aeronaut.getAirport(),
// and an 'aeronaut:airport' window event with the same detail whenever the selection or the mission field changes.
// `selected` is the field departures and new missions use; `mission` is the field of the mission underway (null in free flight).
const airportState=()=>({selected:selection.snapshot(),mission:landing.status==='idle'?null:{...describeField(landing.field),status:landing.status,phase:landing.phase}});
function announceAirport(){window.dispatchEvent(new CustomEvent('aeronaut:airport',{detail:airportState()}));}
function updateAirportUI(){$('landing-entry').innerHTML=`Land at ${selection.airport.name} <i data-lucide="arrow-up-right"></i>`;refreshIcons();}
selection.addEventListener('change',()=>{settings.airport=selection.id;settings.runway=selection.runway;saveSettings();updateAirportUI();announceAirport();});
const query=new URLSearchParams(location.search);
if(query.has('airport'))selection.select(query.get('airport'),query.get('runway')||undefined);
const surfaceName=f=>f.surface==='grass'?'grass':'paved';
// A free-flight start on a 3° final, placed as the landing mission places it; no mission runs.
function approachStart(field=selection.field){cancelLanding(false);saveFlight();const m=new LandingMission(field);m.start(flight);m.cancel();flightMaxAlt=flight.state.position.y;flightTrail.length=0;trailOrigin.copy(flight.state.position);paused=false;lastCrash=false;initialCamera=true;sceneDirty=true;clearControls();$('pause-overlay').hidden=$('crash-overlay').hidden=true;updateAssist();toast(`${field.name} · final for runway ${field.runway}`);}
// A fresh departure: any aircraft may try any field in free flight; a poor fit is named, not refused.
function runwayStart(field=selection.field){
 cancelLanding(false);restart(false);const p=runwayPoint(100,0,field);flight.runwayStart(p.x,world.heightAt(p.x,p.z)+(flight.type.groundClearance??2.8),p.z,field.heading);trailOrigin.copy(flight.state.position);updateAssist();initialCamera=true;sceneDirty=true;
 const fit=suitability(field,flight.type.id),hint=flight.type.runwayHint;
 toast(fit.rating==='unsuitable'?`${flight.type.name}: ${fit.reason.toLowerCase()} · ${field.name} has ${field.runwayLength.toLocaleString('en')} m ${surfaceName(field)}`:/^Runway \d+/.test(hint)?hint.replace(/^Runway \d+/,`${field.name} · runway ${field.runway}`):`${field.name} · ${hint}`);
}
// Starts a scored mission at a field (default: retry the current mission's field). Unsuited aircraft get the brief instead.
function startLanding(field=landing.field){
 if(!missionAvailability(field,flight.type.id).available){cancelLanding(false);showDialog('landing');return false;}
 saveFlight();landing.start(flight,field);setMissionCues(field);flightMaxAlt=flight.state.position.y;flightTrail.length=0;trailOrigin.copy(flight.state.position);trailClock=0;
 paused=false;lastCrash=false;initialCamera=true;sceneDirty=true;missionResultShown=false;clearControls();
 $('pause-overlay').hidden=$('crash-overlay').hidden=$('landing-result').hidden=true;
 $('pause-btn').setAttribute('aria-label','Pause flight');iconButton('pause-btn','pause');
 settings.showHud=true;applyDisplay();saveSettings();
 document.querySelector('.mission-panel').classList.remove('collapsed');
 updateAssist();updateLandingUI();announceAirport();toast(landing.profile.helicopter?'You have control · gently lower collective to settle in the box':`You have control · follow runway ${field.runway}, then flare and idle power`);return true;
}
function cancelLanding(fresh=false){
 landing.cancel();missionResultShown=false;$('landing-result').hidden=true;landingCues.show(false);
 updateLandingUI();announceAirport();if(fresh){restart(false);toast('Free flight · a fresh start in the air');}
}
function updateLandingUI(){
 const underway=landing.status!=='idle',s=flight.state,f=landing.field;
 document.body.classList.toggle('landing-mode',underway);
 document.body.classList.toggle('landing-finished',landing.finished);
 $('flight-mode').textContent=underway?'Landing mission':'Free flight';
 document.querySelector('.map-explore').textContent=underway?`Landing · runway ${f.runway}`:'Free exploration';
 $('mission-title').textContent=underway?`${f.name} · ${f.runway}`:'The Swiss Alps';
 $('landing-guidance').hidden=!underway;$('landing-entry').hidden=underway;
 landingCues.show(landing.active,landing.profile?.helicopter,landing.profile?.clearance);
 if(!underway)return;
 const p=landing.profile,g=landing.guidance(s),h=p.helicopter,rollout=landing.phase==='rollout';
 $('landing-phase').textContent=rollout?'Touchdown · controlled rollout':h?`Precision landing · fixed ${p.contact}`:`Final runway ${f.runway} · ${g.distance>0?(g.distance/1000).toFixed(2)+' km to threshold':'over runway'}`;
 $('landing-speed').textContent=rollout?'Below 6 kt':h?`Below ${Math.round(p.maxSpeed*1.94384)} kt`:`${Math.round(p.speed*1.94384)} kt`;
 $('landing-path-label').textContent=rollout?'Runway left':h?'Height above runway':'Glide path';
 $('landing-path').textContent=rollout?`${Math.round(g.remaining)} m`:h?`${Math.max(0,Math.round(g.height*3.28084))} ft`:Math.abs(g.pathError)<4?'On path':`${Math.round(Math.abs(g.pathError)*3.28084)} ft ${g.pathError>0?'high':'low'}`;
 let cue=rollout?(h?'Lower collective · stay settled':'Idle power · keep straight with Q / E'):h?`Ease down with collective; ${Math.round(p.throttle*100)}% holds a hover.`:g.height<8?'Flare gently with S · reduce power with Ctrl':'Follow the chartreuse cues · small pitch corrections.';
 if(!rollout&&Math.abs(g.cross)>8)cue=`${Math.round(Math.abs(g.cross))} m ${g.cross>0?'right':'left'} of centre · correct gently`;
 else if(!rollout&&g.alignment>12)cue=`Align with runway ${f.runway} · heading ${headingDegrees(f.heading)}°`;
 else if(!rollout&&!h&&(s.speed<p.speedMin||s.speed>p.speedMax))cue=s.speed>p.speedMax?'Too fast · ease power down with Ctrl':'Too slow · add power with Shift';
 $('landing-cue').textContent=cue;
 $('landing-objective').textContent=rollout?`Stay on runway · ${h?`collective <${Math.round(p.settlePower*100)}%`:'power <20%'} · settle 2 sec (${Math.min(2,landing.stableTime).toFixed(1)}/2)`:`${h?`${capital(p.contact)} fixed`:`${flight.type.fixedGear?'Gear fixed':`Gear ${s.gearDown?'down':'UP'}`} · ${flight.type.noFlaps?'no flaps':`flaps ${s.flaps*15}°`}`} · sink <${Math.round(p.maxSink*196.85)} fpm · alignment ≤12°`;
 if(landing.finished&&!missionResultShown){
  missionResultShown=true;clearControls();clearTimeout(toastTimeout);$('toast').classList.remove('visible');$('pause-overlay').hidden=$('crash-overlay').hidden=true;
  const success=landing.status==='success',t=landing.touchdown;
  $('sim-status').textContent=success?'Landing complete':'Mission ended';
  $('landing-result-status').textContent=success?'Mission complete':'Try the approach again';
  $('landing-result-title').textContent=success?`Welcome to ${f.name}.`:'Landing not completed.';
  $('landing-result-reason').textContent=success?(h?`${capital(p.contact)} settled safely in the target box.`:`Safe touchdown and controlled rollout on runway ${f.runway}.`):landing.reason;
  $('landing-result-metrics').innerHTML=t?`<div><dt>Touchdown sink</dt><dd>${Math.round(t.sink*196.85)} <small>fpm</small></dd></div><div><dt>Alignment</dt><dd>${t.alignment.toFixed(1)}<small>°</small></dd></div><div><dt>Touchdown speed</dt><dd>${Math.round(t.speed*1.94384)} <small>kt</small></dd></div><div><dt>Centreline offset</dt><dd>${Math.abs(t.cross).toFixed(1)} <small>m</small></dd></div>`:'<p>No runway touchdown recorded.</p>';
  $('landing-result').hidden=false;$('landing-result-retry').focus();sceneDirty=true;announceAirport();
 }else if(!landing.finished)$('sim-status').textContent=paused?'Simulation paused':'Landing mission · live';
}
function updateAssist(){const a=flight.state.autopilot;document.querySelector('.mission-action').classList.toggle('manual',!a);document.querySelector('.mission-action').classList.toggle('rotorcraft',!!flight.type.flight.rotorcraft);$('assist-status').textContent=a?(flight.type.flight.rotorcraft?'Hover hold':'Flight assist enabled'):'Manual flight';$('take-control').innerHTML=`${a?'Take control':'Enable assist'} <i data-lucide="arrow-up-right"></i>`;refreshIcons();}
function toggleAssist(){if(landing.finished)return;flight.toggleAutopilot();updateAssist();toast(flight.state.autopilot?(flight.type.flight.rotorcraft?'Hover hold · braking to hold position, altitude and heading':'Flight assist on · holding altitude and heading'):(flight.type.flight.rotorcraft?'Manual flight · cyclic to move, collective to climb or descend':'You have control · W/S to pitch, A/D to bank'));}
function setView(value,notify=true){sceneDirty=true;view=value;settings.camera=value;saveSettings();aircraft.setCockpit(view==='cockpit');if(cockpit)cockpit.visible=view==='cockpit';$('camera-label').textContent=({chase:'Chase camera',cockpit:'Cockpit view',orbit:'Orbit camera'})[view];initialCamera=true;if(notify)toast(`${$('camera-label').textContent}${view==='orbit'?' · drag to look around':''}`);}
function cycleView(){const views=['chase','cockpit','orbit'];setView(views[(views.indexOf(view)+1)%views.length]);}
function toggleMap(){settings.showMap=!settings.showMap;applyDisplay();saveSettings();drawMap();}
// Display preferences hide panels but never the stall, terrain and gear warnings, nor a mission card underway.
// While any of them is hidden a restore button stays on screen; it and H show everything again (toggleDisplay).
function applyDisplay(){
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
function flaps(){if(flight.type.flight.rotorcraft||flight.type.noFlaps){toast('No flaps on this aircraft');return;}sceneDirty=true;flight.cycleFlaps();toast(`Flaps set to ${flight.state.flaps*15}°`);}
$('pause-btn').onclick=()=>setPaused(!paused);$('resume-btn').onclick=()=>setPaused(false);$('reset-btn').onclick=()=>restart();$('crash-reset').onclick=()=>restart();$('take-control').onclick=toggleAssist;$('camera-btn').onclick=cycleView;$('map-toggle').onclick=toggleMap;$('map-close').onclick=toggleMap;$('map-framing').onclick=cycleMapFraming;$('map-zoom-in').onclick=()=>zoomMap(1);$('map-zoom-out').onclick=()=>zoomMap(-1);$('map-expand').onclick=()=>showDialog('chart');$('hud-toggle').onclick=toggleHud;$('restore-hud').onclick=toggleHud;$('gear-btn').onclick=gear;$('flaps-btn').onclick=flaps;
$('landing-entry').onclick=()=>showDialog('landing');
for(const id of ['landing-retry','landing-result-retry'])$(id).onclick=()=>startLanding();
for(const id of ['landing-cancel','landing-result-exit'])$(id).onclick=()=>cancelLanding(true);
$('collapse-mission').onclick=()=>{const c=document.querySelector('.mission-panel');c.classList.toggle('collapsed');iconButton('collapse-mission',c.classList.contains('collapsed')?'plus':'minus');};
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
const dialogHead=title=>`<div class="dialog-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Close dialog"><i data-lucide="x"></i></button></div>`;
const toggleMarkup=(id,label,desc,value)=>`<div class="settings-row"><div><strong>${label}</strong><p>${desc}</p></div><button class="toggle" id="${id}" role="switch" aria-label="${label}" aria-checked="${value}"></button></div>`;
// Arrow keys, Home and End move through a radio group by clicking the next choice, as the aircraft roster does.
function radioKeys(selector){dialog.querySelectorAll(selector).forEach(b=>b.onkeydown=e=>{const items=[...dialog.querySelectorAll(selector)],i=items.indexOf(b),next={ArrowDown:(i+1)%items.length,ArrowRight:(i+1)%items.length,ArrowUp:(i+items.length-1)%items.length,ArrowLeft:(i+items.length-1)%items.length,Home:0,End:items.length-1}[e.key];if(next===undefined)return;e.preventDefault();const key=Object.keys(items[next].dataset)[0],value=items[next].dataset[key];items[next].click();const target=dialog.querySelector(`[data-${key}="${value}"]`);target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest'});});}
// Scroll a bounded field list just enough to show its chosen row, without moving the dialog.
function revealChoice(list,selector){const item=list?.querySelector(selector);if(!item)return;const l=list.getBoundingClientRect(),r=item.getBoundingClientRect();if(r.top<l.top)list.scrollTop-=l.top-r.top+2;else if(r.bottom>l.bottom)list.scrollTop+=r.bottom-l.bottom+2;}
// Re-render Explore after a choice, keeping the roster scroll, dialog scroll and focus.
function rerenderExplore(focus){const scroll=dialog.querySelector('.aircraft-options')?.scrollTop??0,fields=dialog.querySelector('.airport-options')?.scrollTop??0,top=dialog.scrollTop;showDialog('explore');dialog.querySelector('.aircraft-options').scrollTop=scroll;dialog.querySelector('.airport-options').scrollTop=fields;dialog.scrollTop=top;dialog.querySelector(focus)?.focus({preventScroll:true});}
const fitText=fit=>fit.rating==='recommended'?fit.reason:fit.rating==='suitable'?'Tight fit · little runway margin':`Not suited · ${fit.reason.toLowerCase()}`;
function airportOption(a){const fit=suitability(a,flight.type.id),on=a.id===selection.id;return`<button class="weather-option airport-option ${on?'selected':''}" role="radio" tabindex="${on?0:-1}" aria-checked="${on}" data-airport="${a.id}"><i data-lucide="map-pin"></i><div><strong>${a.name} <small>${a.ident}</small></strong><span>${region(a.region).name} · ${a.runwayLength.toLocaleString('en')} m ${surfaceName(a)} · ${a.elevation.toLocaleString('en')} m elev.</span><span class="airport-fit ${fit.rating}">${fitText(fit)}</span></div><span></span></button>`;}
function airportDetail(){
 const a=selection.airport,mission=landing.status!=='idle'&&(landing.field.id!==a.id||landing.field.runway!==selection.runway)?`Your landing at ${landing.field.name} ${landing.field.runway} continues. `:'';
 return`<div class="airport-detail"><div class="airport-runways" role="radiogroup" aria-label="Runway at ${a.name}">${a.runways.map(r=>{const on=r.designator===selection.runway;return`<button role="radio" aria-checked="${on}" tabindex="${on?0:-1}" data-runway="${r.designator}">Runway ${r.designator} <small>${headingDegrees(r.heading)}°</small></button>`;}).join('')}</div><p>${a.summary} ${a.runwayLength.toLocaleString('en')} × ${a.runwayWidth} m. ${a.caution}</p><p class="dialog-note">${mission}Choosing a field moves nothing: departures and new landing missions start there.</p></div>`;
}
// The navigation chart: a larger map in a dialog (the flight pauses while it is open, as with every dialog).
function chartAirport(a){const on=a.id===navigationDestination(airportState())?.id,sel=a.id===selection.id,{bearing,distance}=bearingDistance(flight.state.position,a);return`<button class="chart-airport ${on?'selected':''}" role="radio" aria-checked="${sel}" tabindex="${sel?0:-1}" data-airport="${a.id}"><span class="chart-ident">${a.ident}</span><span class="chart-name">${a.name}<small>${region(a.region).name}</small></span><span class="chart-vector">${degrees(bearing)}° <small>${formatNM(distance)}</small></span></button>`;}
function drawChart(){
 if(!chartMap||!dialog.open)return;
 chartMap.draw(navScene(chartFraming,settings.quality==='low'?20:40)); // The flight is paused under a dialog, so the chart may sample more per update.
 const d=navigationDestination(airportState()),n=navReadout();
 const mission=d?.mission?`<p class="chart-mission">Landing mission · runway ${d.runway}. ${selection.id!==d.id?`${selection.airport.name} is selected for the next departure or mission.`:''}</p>`:'';
 const html=d?`<span class="chart-to">${d.mission?'Landing at':'To'} <strong>${d.name}</strong> <small>${d.ident}</small></span><div class="chart-values"><div><span>Bearing</span><strong>${n.bearingText}°</strong></div><div><span>Distance</span><strong>${n.distanceText.replace(' NM','')} <small>NM</small></strong><em>${(n.distance/1000).toFixed(1)} km</em></div><div><span>Time en route</span><strong>${n.ete||'—'}</strong></div></div>${mission}`:'';
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
 revealChoice(dialog.querySelector('.chart-airports'),'[aria-checked=true]');
 requestAnimationFrame(drawChart);
}
// Re-list the fields after a choice, keeping focus on the chosen one.
function rerenderChartList(id){const list=dialog.querySelector('.chart-airports');if(!list)return;list.innerHTML=AIRPORTS.map(chartAirport).join('');list.querySelectorAll('[data-airport]').forEach(b=>b.onclick=()=>{if(selection.select(b.dataset.airport))rerenderChartList(b.dataset.airport);});radioKeys('.chart-airports [data-airport]');revealChoice(list,'[aria-checked=true]');list.querySelector(`[data-airport="${id}"]`)?.focus({preventScroll:true});drawChart();}
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
 clearControls();
 const heli=!!flight.type.flight.rotorcraft;
 let content='';
 if(type==='menu'){content=dialogHead('Flight deck')+`<div class="dialog-body"><button class="menu-link" data-next-dialog="explore">Explore the Alps <i data-lucide="arrow-up-right"></i></button><button class="menu-link" data-next-dialog="chart">Navigation chart <i data-lucide="arrow-up-right"></i></button><button class="menu-link" data-next-dialog="logbook">Flight log <i data-lucide="arrow-up-right"></i></button><button class="menu-link" data-next-dialog="controls">Flight controls <i data-lucide="arrow-up-right"></i></button><button class="menu-link" data-next-dialog="environment">Weather <i data-lucide="arrow-up-right"></i></button></div>`;}else if(type==='environment'){
 content=dialogHead('A change of atmosphere')+`<div class="dialog-body"><p>Find your favorite light. Weather presets change the atmosphere, sunlight, visibility, and water.</p><div class="weather-options">${Object.entries(weatherData).map(([id,w])=>`<button class="weather-option ${settings.weather===id?'selected':''}" data-weather="${id}"><i data-lucide="${w.icon}"></i><div><strong>${w.label}</strong><span>${id==='clear'?'Blue skies. Endless visibility.':id==='golden'?'Warm light across the mountains.':'A moody sky above the valley.'}</span></div><span></span></button>`).join('')}</div><p class="dialog-note">Simulated weather presets. This is a procedural alpine world.</p></div>`;
 }else if(type==='settings'){
 const responseLabels=heli?['Cyclic fore / aft','Cyclic left / right','Yaw pedals','Collective']:['Pitch','Roll','Rudder','Throttle'];
 content=dialogHead('Make it your flight')+`<div class="dialog-body settings-body"><h3 class="dialog-section-title">Flight</h3><div class="settings-row"><div><strong>Graphics quality</strong><p>Balance detail with a smooth flight.</p></div><select id="graphics-quality" aria-label="Graphics quality"><option value="high" ${settings.quality==='high'?'selected':''}>High</option><option value="medium" ${settings.quality==='medium'?'selected':''}>Balanced</option><option value="low" ${settings.quality==='low'?'selected':''}>Performance</option></select></div>${toggleMarkup('setting-assist','Flight assist',heli?'Brakes to a hover; holds position, altitude and heading.':'Holds your heading and altitude.',flight.state.autopilot)}${toggleMarkup('setting-invert','Invert pitch','Swap the up and down flight controls.',settings.invertPitch)}${toggleMarkup('setting-mouse','Mouse steering','Drag across the world to pitch and bank.',settings.mouseSteering)}`
 +`<h3 class="dialog-section-title">Control response</h3><p class="settings-help">How quickly keys, mouse and touch reach full deflection. Holding always gives full travel; 100% is the gentle default.</p><div class="settings-sliders">${['pitch','roll','yaw','throttle'].map((axis,i)=>sliderMarkup(`response-${axis}`,responseLabels[i],settings.response[axis],RESPONSE)).join('')}</div>`
 +`<h3 class="dialog-section-title">Camera</h3><div class="settings-row"><div><strong>View</strong><p>Saved for your next flight; C cycles it.</p></div><div class="segmented" role="radiogroup" aria-label="Camera view">${[['chase','Chase'],['cockpit','Cockpit'],['orbit','Orbit']].map(([id,label])=>`<button role="radio" data-view="${id}" aria-checked="${view===id}" tabindex="${view===id?0:-1}">${label}</button>`).join('')}</div></div><div class="settings-sliders single">${sliderMarkup('chase-distance','Chase distance',settings.chaseDistance,CHASE_DISTANCE)}</div>`
 +`<h3 class="dialog-section-title">Sound</h3>${toggleMarkup('setting-sound','Flight sound','Engines, wind and warning horns.',!settings.muted)}<div class="settings-sliders single">${sliderMarkup('master-volume','Master volume',settings.volume,VOLUME)}</div>`
 +`<h3 class="dialog-section-title">Display</h3>${toggleMarkup('setting-hud','Flight panels','Mission, weather and camera panels. Warnings stay visible; H shows everything.',settings.showHud)}${toggleMarkup('setting-instruments','Instrument strip','Airspeed, altitude, attitude, throttle and pause.',settings.showInstruments)}${toggleMarkup('setting-hints','Key hints','Keyboard reminders and frame rate.',settings.showHints)}${toggleMarkup('setting-crosshair','Crosshair','The centre marker ahead of the aircraft.',settings.showCrosshair)}${toggleMarkup('setting-map','Navigation map','Show your position above the valley.',settings.showMap)}`
 +`<div class="settings-actions"><button class="secondary-btn" id="restore-defaults"><i data-lucide="rotate-ccw"></i>Restore defaults</button><button class="primary-btn" data-close>Back to the skies <i data-lucide="arrow-up-right"></i></button></div><p class="dialog-note">Restoring defaults keeps your aircraft, airfield, flight log and the flight in progress.</p></div>`;
 }else if(type==='controls'){
 const controls=[[heli?'Cyclic forward / backward':'Pitch down / up',['W','S']],[heli?'Cyclic left / right':'Bank left / right',['A','D']],['Alternate flight controls',['←','↑','↓','→']],[heli?'Yaw left / right':'Rudder left / right',['Q','E']],[heli?'Raise / lower collective':'Increase / decrease throttle',['Shift','Ctrl']],['Change camera',['C']],['Pause / resume',['P']],[heli?'Hover hold':'Flight assist',['Space']],...(!heli&&!flight.type.fixedGear?[['Landing gear',['G']]]:[]),...(!heli&&!flight.type.noFlaps?[['Cycle flaps',['F']]]:[]),['Navigation map',['M']],['Map zoom out / in',['−','+']],['Map framing',['V']],['Navigation chart',['N']],['Hide instruments',['H']],['Restart flight',['R']]];
 content=dialogHead('You have control')+`<div class="dialog-body"><p>${heli?`${hoverPercent(flight.type)}% collective hovers. Tilt forward with W to move; center the cyclic to level. Space brakes into a steady hover.`:'A little input goes a long way. Bank gently into turns and add power to climb.'}</p><div class="controls-list">${controls.map(([label,k])=>`<div class="control-row"><span>${label}</span><span>${k.map(v=>`<kbd>${v}</kbd>`).join('')}</span></div>`).join('')}</div><p class="dialog-note">On a phone, drag the left ${heli?'cyclic':'yoke'} to steer and hold + / − to adjust ${heli?'collective; use the two yaw buttons to turn':'throttle'}. In orbit view, drag to look around and scroll to zoom. ${flight.type.name}: ${flight.type.help}</p></div>`;
 }else if(type==='landing'){
 const f=selection.field,p=landingProfile(flight.type),h=p.helicopter,fit=missionAvailability(selection.airport,flight.type.id),hdg=headingDegrees(f.heading),name=flight.type.name;
 const caution=[fit.rating==='suitable'?`Tight fit for the ${name}: little runway to spare after the touchdown zone.`:'',f.caution].filter(Boolean).join(' ');
 content=dialogHead(`Land at ${f.name}`)+`<div class="dialog-body landing-brief"><span class="landing-eyebrow">Landing mission · runway ${f.runway} · heading ${hdg}° · ${f.elevation.toLocaleString('en')} m</span><h3>${name}</h3>`+(fit.available?`<p>${h?`Begin in a hover 46 ft above the marked ${p.contact==='wheels'?'landing':'skid'} box. Ease down with collective; keep the cyclic centred and use Q / E to face ${hdg}°.`:`Begin on a short final for runway ${f.runway}, heading ${hdg}°, with ${flight.type.fixedGear?'fixed gear': 'gear down'} and ${flight.type.noFlaps?'no flaps':'full flaps'}. Follow the three chartreuse approach cues to the outlined touchdown zone.`}</p>${caution?`<p class="mission-caution"><i data-lucide="triangle-alert"></i><span>${caution}</span></p>`:''}<ol><li>${h?`Land inside the small chartreuse box, level and below ${Math.round(p.maxSpeed*1.94384)} kt.`:`Hold ${Math.round(p.speed*1.94384)} kt on approach. W / S adjusts pitch; Shift / Ctrl adjusts power.`}</li><li>${h?`Start at ${Math.round(p.throttle*100)}% collective in a hover. Lower toward ${Math.round(p.throttle*100)-3}% with short taps to descend.`:'Near 25 ft above the runway, gently raise the nose with S to soften the descent. Reduce power with Ctrl.'}</li><li>Touch down below ${Math.round(p.maxSink*196.85)} ft/min, aligned within 12°. ${h?`Keep collective below ${Math.round(p.settlePower*100)}% and settle for 2 seconds.`:'Keep straight with Q / E, set power below 20% and slow below 6 kt for 2 seconds.'}</li></ol><p class="dialog-note">Manual control from the start. Assist remains available. ${h?(p.contact==='wheels'?'Wheeled landing gear is fixed; nothing to lower and no flaps.':'Skids are fixed; no gear or flaps required.'):'Use the first chartreuse zone; leaving the runway or overrunning ends the attempt.'} R retries this mission. Weather is visual; aircraft and runway performance use the existing arcade model.</p><button class="primary-btn" id="start-landing">${h?'Start precision landing':'Start final approach'} <i data-lucide="arrow-up-right"></i></button>`
 :`<p class="mission-caution unavailable" role="note"><i data-lucide="triangle-alert"></i><span>No scored landing here: the ${name} ${fit.reason.toLowerCase()}, and ${f.name} has ${f.runwayLength.toLocaleString('en')} × ${f.runwayWidth} m ${surfaceName(f)}.</span></p><p>Fly this mission at a field that suits it, or choose a lighter aircraft in Explore. You can still depart from ${f.name} in free flight.</p>${fit.alternatives.slice(0,3).map(id=>{const a=AIRPORTS.find(x=>x.id===id);return`<button class="secondary-btn" data-mission-airport="${id}">Land at ${a.name} instead <i data-lucide="arrow-up-right"></i></button>`;}).join('')}<button class="primary-btn" data-next-dialog="explore">Choose another aircraft or field <i data-lucide="arrow-up-right"></i></button>`)+`</div>`;
 }else if(type==='explore'){
 const sel=selection.airport;
 content=dialogHead('A world above it all')+`<div class="dialog-body"><div class="explore-hero"><svg viewBox="0 0 420 140" aria-label="Alpine mountains"><rect width="420" height="140" fill="hsl(197 30% 66%)"/><path d="M0 98 65 25 92 56 155 9 212 88 270 17 352 102 390 48 420 85v55H0" fill="hsl(205 17% 44%)"/><path d="m65 25-27 30 18-5 11 9 8-18 17 15Zm90-16-39 48 29-14 17 9 14-13 36 49Zm115 8-26 32 17-4 12 13 12-10 25 15Z" fill="hsl(195 20% 91%)"/><path d="M0 109 91 69 177 123 271 72 420 112v28H0" fill="hsl(162 18% 29%)"/><path d="M0 140 168 113 252 117 342 140" fill="hsl(182 42% 42%)"/></svg></div><div class="explore-name"><h3>The Swiss Alps</h3><span>FREE FLIGHT</span></div><p class="explore-description">A winding turquoise lake. Snow-covered ridgelines. Quiet villages tucked into the mountains. Explore our original world inspired by Switzerland's Bernese Oberland.</p><h3 class="dialog-section-title fleet-heading">Aircraft <span>${Object.keys(FLEET).length} to fly · scroll to explore</span></h3><div class="weather-options aircraft-options" role="radiogroup" aria-label="Aircraft">${Object.values(FLEET).map(t=>`<button class="weather-option ${t.id===flight.type.id?'selected':''}" role="radio" tabindex="${t.id===flight.type.id?0:-1}" aria-checked="${t.id===flight.type.id}" data-aircraft="${t.id}"><i data-lucide="plane"></i><div><strong>${t.name} <small>${t.badge}</small></strong><span>${t.choice}</span></div><span></span></button>`).join('')}</div><p class="dialog-note">Changing aircraft saves this flight and starts the new one in the air.</p><h3 class="dialog-section-title fleet-heading" id="airport-heading">Airfield <span>${AIRPORTS.length} fields · fit for the ${flight.type.name}</span></h3><div class="weather-options airport-options" role="radiogroup" aria-labelledby="airport-heading">${AIRPORTS.map(airportOption).join('')}</div>${airportDetail()}<button class="primary-btn" id="explore-landing">Land at ${sel.name} · ${selection.runway} <i data-lucide="arrow-up-right"></i></button><button class="primary-btn" id="explore-start">Start in the air <i data-lucide="arrow-up-right"></i></button><button class="secondary-btn" id="runway-start">${heli?'Lift off from':'Depart'} ${sel.name} · runway ${selection.runway} <i data-lucide="plane"></i></button><button class="secondary-btn" data-next-dialog="chart">See ${sel.name} on the navigation chart <i data-lucide="map"></i></button><p class="dialog-note">Original procedural scenery and aircraft. An accessible flight experience with an arcade flight model.</p></div>`;
 }else if(type==='chart'){
 content=dialogHead('Navigation chart')+`<div class="dialog-body chart-body"><div class="chart-map"><canvas id="chart-canvas" tabindex="0" role="img" aria-describedby="chart-help"></canvas><span class="map-north" aria-hidden="true">N <span>↑</span></span></div><div class="chart-side"><div class="chart-readout" id="chart-readout" aria-live="polite"></div><div class="chart-tools"><div class="chart-framing" role="radiogroup" aria-label="Chart framing">${FRAMINGS.map(f=>`<button role="radio" data-framing="${f}">${FRAMING_LABELS[f]}</button>`).join('')}</div><div class="chart-zoom"><button id="chart-zoom-out" aria-label="Zoom chart out"><i data-lucide="minus"></i></button><button id="chart-zoom-in" aria-label="Zoom chart in"><i data-lucide="plus"></i></button></div></div><h3 class="dialog-section-title">Destination</h3><div class="chart-airports" role="radiogroup" aria-label="Destination airfield">${AIRPORTS.map(chartAirport).join('')}</div><p class="dialog-note" id="chart-help">Choose a field here or on the chart to navigate to it; this is the same field Explore departs from and lands at. The bearing points the way and never steers. Drag or use the arrow keys to pan, + and − to zoom.</p><button class="secondary-btn" data-next-dialog="explore">Departures and landing missions <i data-lucide="arrow-up-right"></i></button></div></div>`;
 }else if(type==='logbook'){
 const totalTime=savedFlights.reduce((n,f)=>n+f.time,0)+flight.state.flightTime,totalDistance=savedFlights.reduce((n,f)=>n+f.distance,0)+flight.state.distance;
 content=dialogHead('Every flight is a story')+`<div class="dialog-body"><p>Your time in the skies, saved on this browser.</p><div class="log-stats"><div class="log-stat"><span>Total flight time</span><strong>${formatTime(totalTime)}</strong></div><div class="log-stat"><span>Distance explored</span><strong>${(totalDistance/1852).toFixed(1)} <span>NM</span></strong></div></div><h3 class="dialog-section-title">Current flight</h3><div class="log-row"><span>The Swiss Alps · ${flight.type.name}</span><strong>${formatTime(flight.state.flightTime)}</strong></div><h3 class="dialog-section-title">Previous flights</h3>${savedFlights.length?savedFlights.slice(0,5).map(f=>`<div class="log-row"><span>${new Date(f.date).toLocaleDateString(undefined,{month:'short',day:'numeric'})}${f.aircraft?` · ${aircraftType(f.aircraft).name}`:''} · ${(f.distance/1852).toFixed(1)} NM</span><strong>${formatTime(f.time)}</strong></div>`).join(''):'<div class="empty-log">Your adventure is just beginning. Flights are saved when you restart or leave the simulator.</div>'}</div>`;
 }
 $('dialog-content').innerHTML=content;dialog.classList.toggle('chart-dialog',type==='chart');dialog.classList.toggle('settings-dialog',type==='settings');if(type!=='chart')chartMap=null;
 refreshIcons();if(!dialog.open)dialog.showModal();
 dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dialog.close());dialog.querySelectorAll('[data-next-dialog]').forEach(b=>b.onclick=()=>showDialog(b.dataset.nextDialog));
 dialog.querySelectorAll('[data-weather]').forEach(b=>b.onclick=()=>{setWeather(b.dataset.weather);showDialog('environment');});
 if(type==='settings'){
 $('graphics-quality').onchange=e=>setQuality(e.target.value);
 $('setting-assist').onclick=e=>{flight.toggleAutopilot();e.currentTarget.setAttribute('aria-checked',flight.state.autopilot);updateAssist();};
 for(const [id,key] of [['setting-invert','invertPitch'],['setting-mouse','mouseSteering']])$(id).onclick=e=>{settings[key]=!settings[key];clearControls();e.currentTarget.setAttribute('aria-checked',settings[key]);saveSettings();};
 $('setting-map').onclick=e=>{toggleMap();e.currentTarget.setAttribute('aria-checked',settings.showMap);};
 for(const [id,key] of [['setting-hud','showHud'],['setting-instruments','showInstruments'],['setting-hints','showHints'],['setting-crosshair','showCrosshair']])$(id).onclick=e=>{settings[key]=!settings[key];applyDisplay();saveSettings();e.currentTarget.setAttribute('aria-checked',settings[key]);};
 for(const axis of ['pitch','roll','yaw','throttle'])bindSlider(`response-${axis}`,v=>{settings.response[axis]=v;controls.setResponse(settings.response);});
 bindSlider('chase-distance',v=>{settings.chaseDistance=v;sceneDirty=true;});
 bindSlider('master-volume',v=>{settings.volume=v;audio.setVolume(v);});
 dialog.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{setView(b.dataset.view,false);dialog.querySelectorAll('[data-view]').forEach(o=>{const on=o.dataset.view===view;o.setAttribute('aria-checked',on);o.tabIndex=on?0:-1;});});radioKeys('[data-view]');
 $('setting-sound').onclick=async e=>{const b=e.currentTarget;await setSound(settings.muted);b.setAttribute('aria-checked',!settings.muted);};
 $('restore-defaults').onclick=restoreDefaults;
 }
 if(type==='chart')setupChart();
 if(type==='landing'){if($('start-landing'))$('start-landing').onclick=()=>{if(startLanding(selection.field))dialog.close();};dialog.querySelectorAll('[data-mission-airport]').forEach(b=>b.onclick=()=>{selection.select(b.dataset.missionAirport);showDialog('landing');$('start-landing')?.focus();});}
 if(type==='explore'){
 $('explore-landing').onclick=()=>showDialog('landing');$('explore-start').onclick=()=>{cancelLanding(false);restart();dialog.close();};$('runway-start').onclick=()=>{runwayStart();dialog.close();};
 radioKeys('[data-aircraft]');radioKeys('[data-airport]');radioKeys('[data-runway]');revealChoice(dialog.querySelector('.airport-options'),'.selected');
 dialog.querySelectorAll('[data-aircraft]').forEach(b=>b.onclick=()=>{if(setAircraft(b.dataset.aircraft))rerenderExplore(`[data-aircraft="${b.dataset.aircraft}"]`);});
 // Choosing a field or runway only changes the selection; departures and missions start from the buttons.
 dialog.querySelectorAll('[data-airport]').forEach(b=>b.onclick=()=>{if(selection.select(b.dataset.airport))rerenderExplore(`[data-airport="${b.dataset.airport}"]`);});
 dialog.querySelectorAll('[data-runway]').forEach(b=>b.onclick=()=>{if(selection.select(selection.id,b.dataset.runway))rerenderExplore(`[data-runway="${b.dataset.runway}"]`);});
 }
}
document.querySelectorAll('[data-dialog]').forEach(b=>b.onclick=()=>showDialog(b.dataset.dialog));
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
function formatTime(t){const h=Math.floor(t/3600);return`${h?String(h).padStart(2,'0')+':':''}${String(Math.floor(t/60)%60).padStart(2,'0')}:${String(Math.floor(t)%60).padStart(2,'0')}`;}
const handledKeys=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','ControlLeft','ControlRight','KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE','KeyP','KeyC','KeyG','KeyF','KeyM','KeyH','KeyR','KeyN','KeyV','Minus','Equal','NumpadSubtract','NumpadAdd'];
window.addEventListener('keydown',e=>{
 if(dialog.open||e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;
 if(handledKeys.includes(e.code))e.preventDefault();
 if(e.repeat)return;
 if(!paused&&!flight.state.crashed){keys.add(e.code);queueControls(e.timeStamp/1000);}
 ({KeyP:()=>setPaused(!paused),Space:toggleAssist,KeyC:cycleView,KeyG:gear,KeyF:flaps,KeyM:toggleMap,KeyH:toggleHud,KeyR:()=>restart(),KeyN:()=>showDialog('chart'),KeyV:cycleMapFraming,Minus:()=>zoomMap(-1),NumpadSubtract:()=>zoomMap(-1),Equal:()=>zoomMap(1),NumpadAdd:()=>zoomMap(1)})[e.code]?.();
});
window.addEventListener('keyup',e=>{keys.delete(e.code);queueControls(e.timeStamp/1000);});window.addEventListener('blur',clearControls);
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearControls();});
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

// The navigation map: the world's own height function (as rendering and collisions use), every airport and named
// region, and the route to the destination, which is the mission's field during a mission and the selected field
// otherwise (navigationDestination). It points the way; it never steers or moves the aircraft.
const flightTrail=[];let trailClock=0;const trailOrigin=flight.state.position.clone();
const miniFraming={framing:FRAMINGS.includes(settings.mapFraming)?settings.mapFraming:'route',zoom:THREE.MathUtils.clamp(Number(settings.mapZoom)||3,0,ZOOM_SPANS.length-1)};
const chartFraming={framing:'route',zoom:ZOOM_SPANS.length-1};
miniMap=new NavigationMap($('mini-map'),{heightAt:world.heightAt,compact:true,quality:settings.quality});
let lastNav='',mapDrawMs=0;
const navScene=(framing,budget)=>{const s=flight.state;return{framing,aircraft:{x:s.position.x,z:s.position.z,heading:s.heading},destination:navigationDestination(airportState()),trail:[trailOrigin,...flightTrail],budget};};
const navReadout=()=>navigationReadout({position:flight.state.position,heading:flight.state.heading,speed:flight.state.speed},navigationDestination(airportState()));
function setMapFraming(next){Object.assign(miniFraming,next);if(miniFraming.framing!=='free'){settings.mapFraming=miniFraming.framing;settings.mapZoom=miniFraming.zoom;saveSettings();}drawMap();}
function cycleMapFraming(){const i=FRAMINGS.indexOf(miniFraming.framing);setMapFraming({framing:FRAMINGS[(i+1)%FRAMINGS.length]});toast(`Map · ${FRAMING_LABELS[miniFraming.framing].toLowerCase()} view`);}
function zoomMap(direction){if(!settings.showMap)toggleMap();if(miniMap.view)setMapFraming(zoomFrom(miniFraming,miniMap.view,direction));}
function drawMap(){
 if(!settings.showMap)return;
 const t0=performance.now();miniMap.draw(navScene(miniFraming));mapDrawMs=performance.now()-t0;
 const n=navReadout(),d=navigationDestination(airportState());
 const text=`${d?.ident}|${n?.bearingText}|${n?.distanceText}|${miniFraming.framing}|${d?.mission}`;
 $('map-nav-arrow').style.transform=`rotate(${n?n.relative:0}rad)`;
 if(text!==lastNav){lastNav=text;$('map-nav-ident').textContent=d?d.ident:'—';$('map-nav-bearing').textContent=n?`${n.bearingText}°`:'';$('map-nav-distance').textContent=n?n.distanceText:'';
  $('map-nav').setAttribute('aria-label',d?`${d.mission?'Landing mission at':'Navigate to'} ${d.name}: bearing ${n.bearingText} degrees, ${n.distanceText.replace('NM','nautical miles')}`:'No destination');
  $('map-framing-label').textContent=FRAMING_LABELS[miniFraming.framing];$('map-framing').setAttribute('aria-label',`Map framing: ${FRAMING_LABELS[miniFraming.framing]}. Change framing`);
  $('mini-map').setAttribute('aria-label',d?`Navigation map, ${FRAMING_LABELS[miniFraming.framing].toLowerCase()} view: aircraft and ${d.name}`:'Navigation map');}
}
let lastAssist=true,lastUi=0,lastFps=performance.now(),fpsFrames=0;
function updateUI(time){
 const s=flight.state,h=!!flight.type.flight.rotorcraft;const speed=s.speed*1.94384,alt=s.position.y*3.28084,heading=(s.heading*180/Math.PI+360)%360,vsi=Math.round(s.verticalSpeed*196.85/10)*10;
 $('g-force').textContent=(Math.abs(s.gForce)<0.05?0:s.gForce).toFixed(1);$('g-force-instrument').classList.toggle('overload',s.gForce>6);
 $('speed').textContent=Math.round(speed);$('altitude').textContent=Math.round(alt).toLocaleString();$('agl').textContent=Math.round((s.position.y-world.heightAt(s.position.x,s.position.z))*3.28084).toLocaleString();$('heading').textContent=String(Math.round(heading)%360).padStart(3,'0');$('vertical-speed').textContent=`${vsi>0?'+':''}${vsi}`;$('vertical-state').textContent=Math.abs(vsi)<50?(h&&s.speed<.5?'Hovering':'Level flight'):vsi>0?'Climbing':'Descending';$('heading-cardinal').textContent=['N','NE','E','SE','S','SW','W','NW'][Math.round(heading/45)%8];$('throttle-value').textContent=`${Math.round(s.throttle*100)}%${s.afterburner?' · AB':''}`;$('touch-power-label').textContent=h?`Collective ${Math.round(s.throttle*100)}%`:'Power';$('throttle-slider').value=s.throttle*100;$('gear-state').textContent=h||flight.type.fixedGear?'FIXED':s.gearDown?'DOWN':'UP';$('gear-btn').classList.toggle('active',s.gearDown);$('flaps-state').textContent=h||flight.type.noFlaps?'N/A':`${s.flaps*15}°`;$('flaps-btn').classList.toggle('active',s.flaps>0);$('flight-timer').textContent=formatTime(s.flightTime);$('map-distance').textContent=`${(s.distance/1852).toFixed(1)} NM`;$('speed-marker').style.left=`${Math.min(96,speed/flight.type.speedScale*100)}%`;$('attitude-inner').style.transform=`rotate(${-s.bank*180/Math.PI}deg) translateY(${s.pitch*45}px)`;
 if(lastAssist!==s.autopilot){lastAssist=s.autopilot;updateAssist();}
 $('gear-warning').hidden=!flight.gearWarning||landing.finished;
 const stalled=s.stalled&&!landing.finished&&!s.grounded&&!s.crashed&&!paused&&!dialog.open;
 const onFinal=landing.onFinal(s);
 let notice='';const agl=s.position.y-world.heightAt(s.position.x,s.position.z);if(stalled)notice='STALL · Add power and regain airspeed';else if(!onFinal&&!landing.finished&&agl<(h?12:100)&&!s.grounded&&!s.crashed&&(!h||s.verticalSpeed < -2))notice=h?'TERRAIN · Raise collective':'TERRAIN · Pull up';else if(s.grounded&&landing.status==='idle')notice=h?'On the ground · Raise collective to lift vertically':'On the ground · Add power and pitch up to take off';
 if(notice!==lastNotice){lastNotice=notice;$('flight-notice').textContent=notice;$('flight-notice').classList.toggle('visible',!!notice);$('flight-notice').classList.toggle('warning',stalled||notice.startsWith('TERRAIN'));$('flight-notice').classList.toggle('stall',stalled);}
 updateLandingUI();
 if(s.crashed&&!lastCrash&&landing.status==='idle'){lastCrash=true;$('crash-overlay').hidden=false;$('sim-status').textContent='Flight ended';}
 drawMap();drawChart();
}
function updateCamera(dt){
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
 camera.updateProjectionMatrix();initialCamera=false;
}
const clock=new THREE.Clock();
function tick(){
 requestAnimationFrame(tick);const dt=Math.min(clock.getDelta(),.25);frameTime+=dt;
 const canFly=!paused&&!dialog.open&&!flight.state.crashed&&!landing.finished;
 if(canFly){
  controls.advance(performance.now()/1000,(step,inputs)=>{if(landing.finished)return;flight.update(step,inputs);landing.update(step,flight.state);});flightMaxAlt=Math.max(flightMaxAlt,flight.state.position.y);
  trailClock+=dt;if(trailClock>1){trailClock=0;flightTrail.push({x:flight.state.position.x,z:flight.state.position.z});if(flightTrail.length>2000)flightTrail.shift();}
 }else controls.reset(performance.now()/1000);
 aircraft.group.position.copy(flight.state.position);aircraft.group.quaternion.copy(flight.state.quaternion);cockpit.userData.update?.(flight.state);aircraft.update(canFly?dt:flight.type.flight.rotorcraft?0:dt*.15,flight.state.throttle,{...flight.state,time:frameTime});
 if(canFly||sceneDirty||orbitDrag){world.update(dt,frameTime,flight.state.position);updateCamera(dt);renderer.render(scene,camera);sceneDirty=false;fpsFrames++;}audio.update({...flight.state,stalled:canFly&&flight.state.stalled,throttle:paused||landing.finished?0:flight.state.throttle,speed:paused||landing.finished?0:flight.state.speed,crashed:flight.state.crashed||paused||landing.finished},flight.gearWarning);
 if(frameTime-lastUi>.12){lastUi=frameTime;updateUI(frameTime);}const now=performance.now();if(now-lastFps>1500){if(canFly)$('fps-label').textContent=`${Math.round(fpsFrames/((now-lastFps)/1000))} FPS`;fpsFrames=0;lastFps=now;}
}
function resize(){sceneDirty=true;placeRestore();const w=worldContainer.clientWidth,h=worldContainer.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);initialCamera=true;}
window.addEventListener('resize',resize);
window.addEventListener('beforeunload',saveFlight);
setView(view,false);updateAircraftLabels();updateAirportUI();updateAssist();updateUI(0);updateCamera(1);renderer.render(scene,camera);tick();
setTimeout(()=>{$('loading').classList.add('leaving');setTimeout(()=>$('loading').remove(),750);},500);
// Expose read-only diagnostic snapshots for repeatable rendering and control checks.
window.aeronaut={getState:()=>({...flight.state,position:flight.state.position.toArray(),quaternion:flight.state.quaternion.toArray(),paused,view,quality:settings.quality,weather:settings.weather}),getSettings:()=>structuredClone(settings),getMission:()=>landing.snapshot(),startLanding:()=>startLanding(selection.field),getRendererInfo:()=>({...renderer.info.render}),reset:restart,setPaused, setQuality,setAircraft,runwayStart:(id,runway)=>runwayStart(id?resolveAirport(id,runway).field:selection.field),approachStart:(id,runway)=>approachStart(id?resolveAirport(id,runway).field:selection.field),airports:()=>world.airports.map(({position,windsock,group,...field})=>field),getAirport:airportState,getNavigation:()=>{const n=navReadout();return{destination:navigationDestination(airportState()),bearing:n&&Number(n.bearingText),distance:n?.distance,framing:{...miniFraming},scale:miniMap.scale?.label,pendingTiles:miniMap.pending,drawMs:mapDrawMs};},setMapFraming:(framing,zoom)=>setMapFraming({framing,...(zoom===undefined?{}:{zoom})}),selectAirport:(id,runway)=>selection.select(id,runway),getAircraft:()=>({id:flight.type.id,name:flight.type.name,gearPosition:aircraft.gearPosition,surfaces:aircraft.surfaces,afterburner:aircraft.afterburner})};
if(query.get('start')==='runway')runwayStart();else if(query.get('start')==='approach')approachStart();
