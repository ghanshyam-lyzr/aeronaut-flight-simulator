import './style.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/barlow-condensed/400.css';
import '@fontsource/barlow-condensed/500.css';
import * as THREE from 'three';
import { createIcons, Plane, SlidersHorizontal, Maximize, Minimize, VolumeX, Volume2, MapPin, ArrowUpRight, Sun, CloudSun, Cloud, ChevronDown, ChevronsUpDown, Navigation, Video, Camera, Map, Scan, Minus, Plus, CircleDot, RotateCcw, Pause, Play, Keyboard, Move, TriangleAlert, X, Check, Mountain, Compass, Wind, Menu } from 'lucide';
import { createWorld } from './world.js';
import { createAircraft, createCockpit } from './aircraft.js';
import { FlightController, FlightAudio, FollowFrame } from './flight.js';
import { FLEET, aircraftType } from './fleet.js';

const icons = {Plane,SlidersHorizontal,Maximize,Minimize,VolumeX,Volume2,MapPin,ArrowUpRight,Sun,CloudSun,Cloud,ChevronDown,ChevronsUpDown,Navigation,Video,Camera,Map,Scan,Minus,Plus,CircleDot,RotateCcw,Pause,Play,Keyboard,Move,TriangleAlert,X,Check,Mountain,Compass,Wind,Menu};
const refreshIcons = () => createIcons({icons,attrs:{'stroke-width':1.6}});
refreshIcons();
const $ = id => document.getElementById(id);
const worldContainer = $('world');
const settings = { quality:'high', invertPitch:false, mouseSteering:false, showMap:true, weather:'clear', aircraft:'jet' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('aeronaut-settings') || '{}')); } catch {}
settings.aircraft = aircraftType(settings.aircraft).id;
const saveSettings = () => {try{localStorage.setItem('aeronaut-settings',JSON.stringify(settings));}catch{}};
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
const camera = new THREE.PerspectiveCamera(54,worldContainer.clientWidth/worldContainer.clientHeight,.1,65000);
scene.add(camera);
const world = createWorld(scene,renderer);
let aircraft = createAircraft(settings.aircraft);
scene.add(aircraft.group);
const flight = new FlightController(world.heightAt, settings.aircraft);
flight.toggleAutopilot();
const audio = new FlightAudio();
let paused=false, view='chase', hudVisible=true, frameTime=0, orbitAngle=0.45, orbitHeight=9, orbitDistance=31;
const keys=new Set();
const touch={pitch:0,roll:0,throttle:0};
const mouse={pitch:0,roll:0,active:false};
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
function setQuality(value){settings.quality=value;renderer.setPixelRatio(Math.min(devicePixelRatio,value==='high'?1.75:value==='medium'?1.2:.85));renderer.shadowMap.enabled=value!=='low';world.setQuality?.(value);sceneDirty=true;$('quality-label').textContent=value.charAt(0).toUpperCase()+value.slice(1);saveSettings();}
setWeather(weatherData[settings.weather]?settings.weather:'clear',false);setQuality(settings.quality);
$('map-panel').hidden=!settings.showMap;
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('visible'),3000);}
function iconButton(id,icon){$(id).innerHTML=`<i data-lucide="${icon}"></i>`;refreshIcons();}
function setPaused(value){
 if(flight.state.crashed)return;
 paused=value;sceneDirty=true;$('pause-overlay').hidden=!paused;$('sim-status').textContent=paused?'Simulation paused':'Live simulation';
 $('pause-btn').setAttribute('aria-label',paused?'Resume flight':'Pause flight');iconButton('pause-btn',paused?'play':'pause');
 if(paused)keys.clear();
}
function saveFlight(){const s=flight.state;if(s.flightTime<10)return;const entry={date:new Date().toISOString(),time:s.flightTime,distance:s.distance,maxAltitude:flightMaxAlt,aircraft:s.aircraft};savedFlights.unshift(entry);savedFlights=savedFlights.slice(0,20);try{localStorage.setItem('aeronaut-flights',JSON.stringify(savedFlights));}catch{}}
let flightMaxAlt=flight.state.position.y;
function restart(notify=true){saveFlight();flight.reset();flight.toggleAutopilot();flightMaxAlt=flight.state.position.y;flightTrail.length=0;sceneDirty=true;paused=false;lastCrash=false;initialCamera=true;keys.clear();$('pause-overlay').hidden=true;$('crash-overlay').hidden=true;$('sim-status').textContent='Live simulation';iconButton('pause-btn','pause');updateAssist();if(notify)toast('A fresh start. You have the skies.');}
// Every label that names the aircraft reads from the active fleet type.
function updateAircraftLabels(){const t=flight.type;$('aircraft-name').textContent=t.name;$('aircraft-type').textContent=`${t.type} · ${t.registration}`;$('aircraft-badge').textContent=t.badge;}
// Switching aircraft saves the current flight, then starts the new type fresh in the air with flight assist on.
function setAircraft(id){
 const type=aircraftType(id);if(type.id===flight.type.id)return false;
 saveFlight();flight.setAircraft(type.id);settings.aircraft=type.id;saveSettings();
 scene.remove(aircraft.group);aircraft.dispose?.();aircraft=createAircraft(type.id);scene.add(aircraft.group);aircraft.setCockpit(view==='cockpit');
 camera.remove(cockpit);cockpit=createCockpit(type.id);camera.add(cockpit);cockpit.visible=view==='cockpit';
 restart(false);updateAircraftLabels();toast(`${type.name} ready · a fresh start in the air`);return true;
}
function runwayStart(){restart(false);flight.runwayStart(900,80.8,-1350);updateAssist();initialCamera=true;sceneDirty=true;toast(flight.type.runwayHint);}
function updateAssist(){const a=flight.state.autopilot;document.querySelector('.mission-action').classList.toggle('manual',!a);$('assist-status').textContent=a?'Flight assist enabled':'Manual flight';$('take-control').innerHTML=`${a?'Take control':'Enable assist'} <i data-lucide="arrow-up-right"></i>`;refreshIcons();}
function toggleAssist(){flight.toggleAutopilot();updateAssist();toast(flight.state.autopilot?'Flight assist on · holding altitude and heading':'You have control · W/S to pitch, A/D to bank');}
function setView(value){sceneDirty=true;view=value;aircraft.setCockpit(view==='cockpit');if(cockpit)cockpit.visible=view==='cockpit';$('camera-label').textContent=({chase:'Chase camera',cockpit:'Cockpit view',orbit:'Orbit camera'})[view];initialCamera=true;toast(`${$('camera-label').textContent}${view==='orbit'?' · drag to look around':''}`);}
function cycleView(){const views=['chase','cockpit','orbit'];setView(views[(views.indexOf(view)+1)%views.length]);}
function toggleMap(){settings.showMap=!settings.showMap;$('map-panel').hidden=!settings.showMap;saveSettings();}
function toggleHud(){hudVisible=!hudVisible;$('hud').hidden=!hudVisible;$('restore-hud').hidden=hudVisible;}
function gear(){sceneDirty=true;flight.toggleGear();toast(`Landing gear ${flight.state.gearDown?'down':'retracted'}`);}
function flaps(){sceneDirty=true;flight.cycleFlaps();toast(`Flaps set to ${flight.state.flaps*15}°`);}
$('pause-btn').onclick=()=>setPaused(!paused);$('resume-btn').onclick=()=>setPaused(false);$('reset-btn').onclick=()=>restart();$('crash-reset').onclick=()=>restart();$('take-control').onclick=toggleAssist;$('camera-btn').onclick=cycleView;$('map-toggle').onclick=toggleMap;$('map-close').onclick=toggleMap;$('hud-toggle').onclick=toggleHud;$('restore-hud').onclick=toggleHud;$('gear-btn').onclick=gear;$('flaps-btn').onclick=flaps;
$('collapse-mission').onclick=()=>{const c=document.querySelector('.mission-panel');c.classList.toggle('collapsed');iconButton('collapse-mission',c.classList.contains('collapsed')?'plus':'minus');};
$('throttle-slider').addEventListener('input',e=>{flight.state.throttle=Number(e.target.value)/100;});
$('sound-btn').onclick=async()=>{if(!audio.enabled)await audio.start();else audio.toggle();iconButton('sound-btn',audio.enabled?'volume-2':'volume-x');$('sound-btn').setAttribute('aria-label',audio.enabled?'Mute engine sound':'Enable engine sound');toast(audio.enabled?'Engine sound on':'Engine sound off');};
$('fullscreen-btn').onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch{toast('Open the preview in its own tab for fullscreen.');}};
document.addEventListener('fullscreenchange',()=>iconButton('fullscreen-btn',document.fullscreenElement?'minimize':'maximize'));
$('photo-btn').onclick=()=>{renderer.render(scene,camera);const a=document.createElement('a');a.download=`aeronaut-${Date.now()}.png`;a.href=renderer.domElement.toDataURL('image/png');a.click();toast('Flight photo saved');};
$('nav-flight').onclick=()=>{if($('main-dialog').open)$('main-dialog').close();};

const dialog=$('main-dialog');
const dialogHead=title=>`<div class="dialog-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Close dialog"><i data-lucide="x"></i></button></div>`;
const toggleMarkup=(id,label,desc,value)=>`<div class="settings-row"><div><strong>${label}</strong><p>${desc}</p></div><button class="toggle" id="${id}" role="switch" aria-label="${label}" aria-checked="${value}"></button></div>`;
function showDialog(type){
 keys.clear();
 let content='';
 if(type==='menu'){content=dialogHead('Flight deck')+`<div class="dialog-body"><button class="menu-link" data-next-dialog="explore">Explore the Alps <i data-lucide="arrow-up-right"></i></button><button class="menu-link" data-next-dialog="logbook">Flight log <i data-lucide="arrow-up-right"></i></button><button class="menu-link" data-next-dialog="controls">Flight controls <i data-lucide="arrow-up-right"></i></button><button class="menu-link" data-next-dialog="environment">Weather <i data-lucide="arrow-up-right"></i></button></div>`;}else if(type==='environment'){
 content=dialogHead('A change of atmosphere')+`<div class="dialog-body"><p>Find your favorite light. Weather presets change the atmosphere, sunlight, visibility, and water.</p><div class="weather-options">${Object.entries(weatherData).map(([id,w])=>`<button class="weather-option ${settings.weather===id?'selected':''}" data-weather="${id}"><i data-lucide="${w.icon}"></i><div><strong>${w.label}</strong><span>${id==='clear'?'Blue skies. Endless visibility.':id==='golden'?'Warm light across the mountains.':'A moody sky above the valley.'}</span></div><span></span></button>`).join('')}</div><p class="dialog-note">Simulated weather presets. This is a procedural alpine world.</p></div>`;
 }else if(type==='settings'){
 content=dialogHead('Make it your flight')+`<div class="dialog-body"><div class="settings-row"><div><strong>Graphics quality</strong><p>Balance detail with a smooth flight.</p></div><select id="graphics-quality" aria-label="Graphics quality"><option value="high" ${settings.quality==='high'?'selected':''}>High</option><option value="medium" ${settings.quality==='medium'?'selected':''}>Balanced</option><option value="low" ${settings.quality==='low'?'selected':''}>Performance</option></select></div>${toggleMarkup('setting-assist','Flight assist','Holds your heading and altitude.',flight.state.autopilot)}${toggleMarkup('setting-invert','Invert pitch','Swap the up and down flight controls.',settings.invertPitch)}${toggleMarkup('setting-mouse','Mouse steering','Drag across the world to pitch and bank.',settings.mouseSteering)}${toggleMarkup('setting-map','Navigation map','Show your position above the valley.',settings.showMap)}<button class="primary-btn" data-close>Back to the skies <i data-lucide="arrow-up-right"></i></button></div>`;
 }else if(type==='controls'){
 const controls=[['Pitch up / down',['S','W']],['Bank left / right',['A','D']],['Alternate flight controls',['←','↑','↓','→']],['Rudder left / right',['Q','E']],['Increase / decrease throttle',['Shift','Ctrl']],['Change camera',['C']],['Pause / resume',['P']],['Flight assist',['Space']],['Landing gear',['G']],['Cycle flaps',['F']],['Navigation map',['M']],['Hide instruments',['H']],['Restart flight',['R']]];
 content=dialogHead('You have control')+`<div class="dialog-body"><p>A little input goes a long way. Bank gently into turns and add power to climb.</p><div class="controls-list">${controls.map(([label,k])=>`<div class="control-row"><span>${label}</span><span>${k.map(v=>`<kbd>${v}</kbd>`).join('')}</span></div>`).join('')}</div><p class="dialog-note">On a phone, drag the left yoke to steer and hold + / − to adjust throttle. In orbit view, drag to look around and scroll to zoom. ${flight.type.name}: ${flight.type.help}</p></div>`;
 }else if(type==='explore'){
 content=dialogHead('A world above it all')+`<div class="dialog-body"><div class="explore-hero"><svg viewBox="0 0 420 140" aria-label="Alpine mountains"><rect width="420" height="140" fill="hsl(197 30% 66%)"/><path d="M0 98 65 25 92 56 155 9 212 88 270 17 352 102 390 48 420 85v55H0" fill="hsl(205 17% 44%)"/><path d="m65 25-27 30 18-5 11 9 8-18 17 15Zm90-16-39 48 29-14 17 9 14-13 36 49Zm115 8-26 32 17-4 12 13 12-10 25 15Z" fill="hsl(195 20% 91%)"/><path d="M0 109 91 69 177 123 271 72 420 112v28H0" fill="hsl(162 18% 29%)"/><path d="M0 140 168 113 252 117 342 140" fill="hsl(182 42% 42%)"/></svg></div><div class="explore-name"><h3>The Swiss Alps</h3><span>FREE FLIGHT</span></div><p class="explore-description">A winding turquoise lake. Snow-covered ridgelines. Quiet villages tucked into the mountains. Explore our original world inspired by Switzerland's Bernese Oberland.</p><h3 class="dialog-section-title">Aircraft</h3><div class="weather-options aircraft-options" role="radiogroup" aria-label="Aircraft">${Object.values(FLEET).map(t=>`<button class="weather-option ${t.id===flight.type.id?'selected':''}" role="radio" aria-checked="${t.id===flight.type.id}" data-aircraft="${t.id}"><i data-lucide="plane"></i><div><strong>${t.summary}</strong><span>${t.choice}</span></div><span></span></button>`).join('')}</div><p class="dialog-note">Changing aircraft saves this flight and starts the new one in the air.</p><div class="log-row"><span>Airfield</span><strong>Alpine Valley · runway 36</strong></div><div class="log-row"><span>Experience</span><strong>Open world · no flight plan</strong></div><button class="primary-btn" id="explore-start">Start in the air <i data-lucide="arrow-up-right"></i></button><button class="secondary-btn" id="runway-start">Start on the runway <i data-lucide="plane"></i></button><p class="dialog-note">Original procedural scenery and aircraft. An accessible flight experience with an arcade flight model.</p></div>`;
 }else if(type==='logbook'){
 const totalTime=savedFlights.reduce((n,f)=>n+f.time,0)+flight.state.flightTime,totalDistance=savedFlights.reduce((n,f)=>n+f.distance,0)+flight.state.distance;
 content=dialogHead('Every flight is a story')+`<div class="dialog-body"><p>Your time in the skies, saved on this browser.</p><div class="log-stats"><div class="log-stat"><span>Total flight time</span><strong>${formatTime(totalTime)}</strong></div><div class="log-stat"><span>Distance explored</span><strong>${(totalDistance/1852).toFixed(1)} <span>NM</span></strong></div></div><h3 class="dialog-section-title">Current flight</h3><div class="log-row"><span>The Swiss Alps · ${flight.type.name}</span><strong>${formatTime(flight.state.flightTime)}</strong></div><h3 class="dialog-section-title">Previous flights</h3>${savedFlights.length?savedFlights.slice(0,5).map(f=>`<div class="log-row"><span>${new Date(f.date).toLocaleDateString(undefined,{month:'short',day:'numeric'})}${f.aircraft?` · ${aircraftType(f.aircraft).name}`:''} · ${(f.distance/1852).toFixed(1)} NM</span><strong>${formatTime(f.time)}</strong></div>`).join(''):'<div class="empty-log">Your adventure is just beginning. Flights are saved when you restart or leave the simulator.</div>'}</div>`;
 }
 $('dialog-content').innerHTML=content;
 refreshIcons();if(!dialog.open)dialog.showModal();
 dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dialog.close());dialog.querySelectorAll('[data-next-dialog]').forEach(b=>b.onclick=()=>showDialog(b.dataset.nextDialog));
 dialog.querySelectorAll('[data-weather]').forEach(b=>b.onclick=()=>{setWeather(b.dataset.weather);showDialog('environment');});
 if(type==='settings'){
 $('graphics-quality').onchange=e=>setQuality(e.target.value);
 $('setting-assist').onclick=e=>{flight.toggleAutopilot();e.currentTarget.setAttribute('aria-checked',flight.state.autopilot);updateAssist();};
 for(const [id,key] of [['setting-invert','invertPitch'],['setting-mouse','mouseSteering']])$(id).onclick=e=>{settings[key]=!settings[key];e.currentTarget.setAttribute('aria-checked',settings[key]);saveSettings();};
 $('setting-map').onclick=e=>{toggleMap();e.currentTarget.setAttribute('aria-checked',settings.showMap);};
 }
 if(type==='explore'){$('explore-start').onclick=()=>{restart();dialog.close();};$('runway-start').onclick=()=>{runwayStart();dialog.close();};dialog.querySelectorAll('[data-aircraft]').forEach(b=>b.onclick=()=>{if(setAircraft(b.dataset.aircraft))showDialog('explore');});}
}
document.querySelectorAll('[data-dialog]').forEach(b=>b.onclick=()=>showDialog(b.dataset.dialog));
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
function formatTime(t){const h=Math.floor(t/3600);return`${h?String(h).padStart(2,'0')+':':''}${String(Math.floor(t/60)%60).padStart(2,'0')}:${String(Math.floor(t)%60).padStart(2,'0')}`;}
const handledKeys=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','ControlLeft','ControlRight','KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE','KeyP','KeyC','KeyG','KeyF','KeyM','KeyH','KeyR'];
window.addEventListener('keydown',e=>{
 if(dialog.open||(e.target instanceof HTMLInputElement&&e.target.type!=='range')||e.target instanceof HTMLSelectElement)return;
 if(handledKeys.includes(e.code))e.preventDefault();
 keys.add(e.code);if(e.repeat)return;
 ({KeyP:()=>setPaused(!paused),Space:toggleAssist,KeyC:cycleView,KeyG:gear,KeyF:flaps,KeyM:toggleMap,KeyH:toggleHud,KeyR:()=>restart()})[e.code]?.();
});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();touch.pitch=0;touch.roll=0;touch.throttle=0;mouse.active=false;});
let orbitDrag=null;
worldContainer.addEventListener('pointerdown',e=>{if(dialog.open)return;worldContainer.focus();if(view==='orbit'){orbitDrag={x:e.clientX,y:e.clientY};worldContainer.setPointerCapture(e.pointerId);}else if(settings.mouseSteering){mouse.active=true;worldContainer.setPointerCapture(e.pointerId);}});
worldContainer.addEventListener('pointermove',e=>{if(orbitDrag){sceneDirty=true;orbitAngle-=(e.clientX-orbitDrag.x)*.008;orbitHeight=THREE.MathUtils.clamp(orbitHeight+(e.clientY-orbitDrag.y)*.09,-8,35);orbitDrag={x:e.clientX,y:e.clientY};}else if(mouse.active){const r=worldContainer.getBoundingClientRect();mouse.roll=THREE.MathUtils.clamp((e.clientX-r.left-r.width/2)/(r.width*.3),-1,1);mouse.pitch=THREE.MathUtils.clamp(-(e.clientY-r.top-r.height/2)/(r.height*.3),-1,1);}});
const stopPointer=()=>{orbitDrag=null;mouse.active=false;mouse.pitch=0;mouse.roll=0;};worldContainer.addEventListener('pointerup',stopPointer);worldContainer.addEventListener('pointercancel',stopPointer);
worldContainer.addEventListener('wheel',e=>{if(view==='orbit'){e.preventDefault();sceneDirty=true;orbitDistance=THREE.MathUtils.clamp(orbitDistance+e.deltaY*.025,18,85);}},{passive:false});
const yoke=$('touch-yoke'),knob=$('yoke-knob');let yokeId=null;
function yokeMove(e){const r=yoke.getBoundingClientRect(),dx=THREE.MathUtils.clamp((e.clientX-r.left-r.width/2)/39,-1,1),dy=THREE.MathUtils.clamp((e.clientY-r.top-r.height/2)/39,-1,1);touch.roll=dx;touch.pitch=-dy;knob.style.transform=`translate(${dx*29}px,${dy*29}px)`;}
yoke.addEventListener('pointerdown',e=>{e.preventDefault();yokeId=e.pointerId;yoke.setPointerCapture(e.pointerId);yokeMove(e);});yoke.addEventListener('pointermove',e=>{if(e.pointerId===yokeId)yokeMove(e);});
function resetYoke(){yokeId=null;touch.pitch=0;touch.roll=0;knob.style.transform='';}yoke.addEventListener('pointerup',resetYoke);yoke.addEventListener('pointercancel',resetYoke);
for(const [id,v]of [['throttle-up',1],['throttle-down',-1]]){const b=$(id);b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);touch.throttle=v;};b.onpointerup=()=>touch.throttle=0;b.onpointercancel=()=>touch.throttle=0;}

// The map uses the same height function as the world and flight collisions.
const mapCanvas=$('mini-map'),mapCtx=mapCanvas.getContext('2d');mapCanvas.width=480;mapCanvas.height=310;
const mapTexture=document.createElement('canvas');mapTexture.width=240;mapTexture.height=155;const mapTextureCtx=mapTexture.getContext('2d');const mapImage=mapTextureCtx.createImageData(240,155);
const mapBounds={xmin:-6500,xmax:6500,zmin:-7500,zmax:7500};
for(let y=0;y<155;y++)for(let x=0;x<240;x++){
 const wx=mapBounds.xmin+(x/240)*(mapBounds.xmax-mapBounds.xmin),wz=mapBounds.zmin+(y/155)*(mapBounds.zmax-mapBounds.zmin),h=world.heightAt(wx,wz),i=(y*240+x)*4;
 let c;if(h<=10.1)c=[39,90,94];else{const shade=THREE.MathUtils.clamp((world.heightAt(wx+35,wz)-h)*.17,-15,15),n=Math.min(h/2500,1),contour=h%180<15?-9:0;c=[40+n*46+shade+contour,59+n*42+shade+contour,46+n*44+shade+contour];}mapImage.data.set([...c,255],i);
}mapTextureCtx.putImageData(mapImage,0,0);
function mapPoint(x,z){return[(x-mapBounds.xmin)/(mapBounds.xmax-mapBounds.xmin)*480,(z-mapBounds.zmin)/(mapBounds.zmax-mapBounds.zmin)*310];}
const flightTrail=[];let trailClock=0;
function drawMap(){mapCtx.drawImage(mapTexture,0,0,480,310);mapCtx.strokeStyle='rgba(205,245,107,.55)';mapCtx.lineWidth=1.5;mapCtx.setLineDash([5,5]);mapCtx.beginPath();const start=mapPoint(0,1900);mapCtx.moveTo(...start);for(const p of flightTrail)mapCtx.lineTo(...mapPoint(p.x,p.z));const p=mapPoint(flight.state.position.x,flight.state.position.z);mapCtx.lineTo(...p);mapCtx.stroke();mapCtx.setLineDash([]);mapCtx.save();mapCtx.translate(...p);mapCtx.rotate(flight.state.heading);mapCtx.beginPath();mapCtx.moveTo(0,-11);mapCtx.lineTo(7,9);mapCtx.lineTo(0,5);mapCtx.lineTo(-7,9);mapCtx.closePath();mapCtx.fillStyle='#d0f767';mapCtx.strokeStyle='#1d332a';mapCtx.lineWidth=2;mapCtx.fill();mapCtx.stroke();mapCtx.restore();const ap=mapPoint(900,-1800);mapCtx.fillStyle='#c4cbb7';mapCtx.save();mapCtx.translate(...ap);mapCtx.rotate(-.1);mapCtx.fillRect(-2,-10,4,20);mapCtx.restore();}
let lastAssist=true,lastUi=0,lastFps=performance.now(),fpsFrames=0;
function updateUI(time){
 const s=flight.state;const speed=s.speed*1.94384,alt=s.position.y*3.28084,heading=(s.heading*180/Math.PI+360)%360,vsi=s.verticalSpeed*196.85;
 $('speed').textContent=Math.round(speed);$('altitude').textContent=Math.round(alt).toLocaleString();$('agl').textContent=Math.round((s.position.y-world.heightAt(s.position.x,s.position.z))*3.28084).toLocaleString();$('heading').textContent=String(Math.round(heading)%360).padStart(3,'0');$('vertical-speed').textContent=`${vsi>30?'+':''}${Math.round(vsi/10)*10}`;$('vertical-state').textContent=Math.abs(vsi)<50?'Level flight':vsi>0?'Climbing':'Descending';$('heading-cardinal').textContent=['N','NE','E','SE','S','SW','W','NW'][Math.round(heading/45)%8];$('throttle-value').textContent=`${Math.round(s.throttle*100)}%${s.afterburner?' · AB':''}`;$('throttle-slider').value=s.throttle*100;$('gear-state').textContent=s.gearDown?'DOWN':'UP';$('gear-btn').classList.toggle('active',s.gearDown);$('flaps-state').textContent=`${s.flaps*15}°`;$('flaps-btn').classList.toggle('active',s.flaps>0);$('flight-timer').textContent=formatTime(s.flightTime);$('map-distance').textContent=`${(s.distance/1852).toFixed(1)} NM`;$('speed-marker').style.left=`${Math.min(96,speed/flight.type.speedScale*100)}%`;$('attitude-inner').style.transform=`rotate(${-s.bank*180/Math.PI}deg) translateY(${s.pitch*45}px)`;
 if(lastAssist!==s.autopilot){lastAssist=s.autopilot;updateAssist();}
 let notice='';const agl=s.position.y-world.heightAt(s.position.x,s.position.z);if(s.stalled)notice='STALL · Lower the nose and add power';else if(agl<100&&!s.grounded&&!s.crashed)notice='TERRAIN · Pull up';else if(s.grounded)notice='On the ground · Add power and pitch up to take off';
 if(notice!==lastNotice){lastNotice=notice;$('flight-notice').textContent=notice;$('flight-notice').classList.toggle('visible',!!notice);$('flight-notice').classList.toggle('warning',s.stalled||agl<100);}
 if(s.crashed&&!lastCrash){lastCrash=true;$('crash-overlay').hidden=false;$('sim-status').textContent='Flight ended';}
 if(settings.showMap)drawMap();
}
function updateCamera(dt){
 const s=flight.state;horizontalEuler.set(0,-s.heading,0);horizontalQuat.setFromEuler(horizontalEuler);
 const free=flight.type.flight.aerobatic,frame=free?(initialCamera?followFrame.reset(s.quaternion):followFrame.update(s.quaternion,dt,s.bodyRates.pitch)):horizontalQuat;
 camera.up.set(0,1,0);if(free)camera.up.applyQuaternion(frame);
 if(view==='cockpit'){
  offset.set(0,1.05,-1.8).applyQuaternion(s.quaternion);camera.position.copy(s.position).add(offset);camera.quaternion.copy(s.quaternion);camera.fov=67;
 }else{
  if(view==='orbit')offset.set(Math.sin(orbitAngle)*orbitDistance,orbitHeight,Math.cos(orbitAngle)*orbitDistance);
  else {const portraitFactor=THREE.MathUtils.clamp(1.2/camera.aspect,1,2.3);offset.set(0,8.3*portraitFactor,23*portraitFactor);}
  offset.applyQuaternion(frame);cameraPosition.copy(s.position).add(offset);
  // Chase stays on the heading centerline; world-space lag drifts sideways in turns.
  if(view==='chase')camera.position.copy(cameraPosition);
  else camera.position.lerp(cameraPosition,initialCamera?1:1-Math.exp(-dt*4));
  target.set(0,view==='orbit'?0:-.1,view==='orbit'?0:-8*THREE.MathUtils.clamp(1.2/camera.aspect,1,2.3)).applyQuaternion(frame).add(s.position);camera.lookAt(target);camera.fov=view==='orbit'?52:53;
 }
 camera.updateProjectionMatrix();initialCamera=false;
}
const clock=new THREE.Clock();
function tick(){
 requestAnimationFrame(tick);const dt=Math.min(clock.getDelta(),.07);frameTime+=dt;
 const canFly=!paused&&!dialog.open&&!flight.state.crashed;
 if(canFly){
  const pressed=(...k)=>k.some(v=>keys.has(v))?1:0;
  const inputs={pitch:(pressed('KeyS','ArrowDown')-pressed('KeyW','ArrowUp')+touch.pitch+(mouse.active?mouse.pitch:0))*(settings.invertPitch?-1:1),roll:pressed('KeyD','ArrowRight')-pressed('KeyA','ArrowLeft')+touch.roll+(mouse.active?mouse.roll:0),yaw:pressed('KeyE')-pressed('KeyQ'),throttle:pressed('ShiftLeft','ShiftRight')-pressed('ControlLeft','ControlRight')+touch.throttle};
  flight.update(dt,inputs);flightMaxAlt=Math.max(flightMaxAlt,flight.state.position.y);
  trailClock+=dt;if(trailClock>1){trailClock=0;flightTrail.push({x:flight.state.position.x,z:flight.state.position.z});if(flightTrail.length>2000)flightTrail.shift();}
 }
 aircraft.group.position.copy(flight.state.position);aircraft.group.quaternion.copy(flight.state.quaternion);aircraft.update(canFly?dt:dt*.15,flight.state.throttle,{...flight.state,time:frameTime});
 if(canFly||sceneDirty||orbitDrag){world.update(dt,frameTime,flight.state.position);updateCamera(dt);renderer.render(scene,camera);sceneDirty=false;fpsFrames++;}audio.update({...flight.state,throttle:paused?0:flight.state.throttle,speed:paused?0:flight.state.speed,crashed:flight.state.crashed||paused});
 if(frameTime-lastUi>.12){lastUi=frameTime;updateUI(frameTime);}const now=performance.now();if(now-lastFps>1500){if(canFly)$('fps-label').textContent=`${Math.round(fpsFrames/((now-lastFps)/1000))} FPS`;fpsFrames=0;lastFps=now;}
}
function resize(){sceneDirty=true;const w=worldContainer.clientWidth,h=worldContainer.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);initialCamera=true;}
window.addEventListener('resize',resize);
window.addEventListener('beforeunload',saveFlight);
updateAircraftLabels();updateUI(0);updateCamera(1);renderer.render(scene,camera);tick();
setTimeout(()=>{$('loading').classList.add('leaving');setTimeout(()=>$('loading').remove(),750);},500);
// Expose read-only diagnostic snapshots for repeatable rendering and control checks.
window.aeronaut={getState:()=>({...flight.state,position:flight.state.position.toArray(),quaternion:flight.state.quaternion.toArray(),paused,view,quality:settings.quality,weather:settings.weather}),getRendererInfo:()=>({...renderer.info.render}),reset:restart,setPaused, setQuality,setAircraft,runwayStart,getAircraft:()=>({id:flight.type.id,name:flight.type.name,gearPosition:aircraft.gearPosition,surfaces:aircraft.surfaces,afterburner:aircraft.afterburner})};
