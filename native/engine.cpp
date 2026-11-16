// Allocation-free flight and terrain kernel. SI units and double precision.
// Rendering, input events, UI and audio remain in their existing browser layer.
#include <cmath>
#include <cstdint>
#include <algorithm>
using std::sin; using std::cos; using std::sqrt; using std::exp; using std::floor;
using std::abs; using std::min; using std::max;
constexpr double PI = 3.14159265358979323846, TAU = 2 * PI, G = 9.81;
inline double clamp(double x, double a, double b) { return min(b, max(a, x)); }
inline double mix(double a, double b, double t) { return a + (b - a) * t; }
inline double damp(double a, double b, double rate, double dt) { return mix(a, b, 1 - exp(-rate * dt)); }
inline double wrap(double a) { return std::fmod(std::fmod(a, TAU) + TAU, TAU); }
inline double angleError(double a, double b) { return std::atan2(sin(a - b), cos(a - b)); }
struct vec2 { double x, y; vec2(double x, double y): x(x), y(y) {} };
inline double length(vec2 v) { return sqrt(v.x * v.x + v.y * v.y); }
#include "generated/terrain.h"
#include "generated/abi.h"

extern "C" double height_at(double x, double z) __attribute__((import_module("env"), import_name("height_at")));
struct V {
  double x = 0, y = 0, z = 0;
  V operator+(V b) const { return {x + b.x, y + b.y, z + b.z}; }
  V operator-(V b) const { return {x - b.x, y - b.y, z - b.z}; }
  V operator*(double k) const { return {x * k, y * k, z * k}; }
  double dot(V b) const { return x * b.x + y * b.y + z * b.z; }
  V cross(V b) const { return {y * b.z - z * b.y, z * b.x - x * b.z, x * b.y - y * b.x}; }
  double length() const { return sqrt(dot(*this)); }
  V normalized() const { double n = length(); return *this * (n ? 1 / n : 1); }
};
struct Q {
  double x = 0, y = 0, z = 0, w = 1;
  Q operator*(Q b) const {
    return {x * b.w + w * b.x + y * b.z - z * b.y,
      y * b.w + w * b.y + z * b.x - x * b.z,
      z * b.w + w * b.z + x * b.y - y * b.x,
      w * b.w - x * b.x - y * b.y - z * b.z};
  }
  Q normalized() const {
    double n = sqrt(x*x + y*y + z*z + w*w);
    return n ? Q{x/n, y/n, z/n, w/n} : Q{};
  }
  V apply(V v) const { V axis{x,y,z}, t = axis.cross(v) * 2; return v + t * w + axis.cross(t); }
  static Q euler(double pitch, double yaw, double roll) {
    double c1=cos(pitch/2), c2=cos(yaw/2), c3=cos(roll/2), s1=sin(pitch/2), s2=sin(yaw/2), s3=sin(roll/2);
    return {s1*c2*c3+c1*s2*s3, c1*s2*c3-s1*c2*s3, c1*c2*s3-s1*s2*c3, c1*c2*c3+s1*s2*s3};
  }
  static Q axisAngle(V a, double angle) { double s=sin(angle/2); return {a.x*s,a.y*s,a.z*s,cos(angle/2)}; }
  double angleTo(Q b) const { return 2 * std::acos(abs(clamp(x*b.x+y*b.y+z*b.z+w*b.w,-1,1))); }
  Q towards(Q b, double step) const {
    double angle = angleTo(b); if (angle == 0) return *this;
    double t=min(1.,step/angle); if (t==1) return b;
    double c=x*b.x+y*b.y+z*b.z+w*b.w;
    if (c<0) { b={-b.x,-b.y,-b.z,-b.w}; c=-c; }
    if (c>=1) return *this;
    double ss=1-c*c;
    if (ss<=2.220446049250313e-16) return Q{mix(x,b.x,t),mix(y,b.y,t),mix(z,b.z,t),mix(w,b.w,t)}.normalized();
    double sn=sqrt(ss), half=std::atan2(sn,c), a=sin((1-t)*half)/sn, d=sin(t*half)/sn;
    return {x*a+b.x*d,y*a+b.y*d,z*a+b.z*d,w*a+b.w*d};
  }
};
struct Angular { double rate, angle; };
Angular angular(double current, double target, double response, double dt) {
  double rate=response*((current*target<0 || abs(target)<abs(current)) ? 4 : 1);
  if (current*target<0) {
    double stop=std::log1p(abs(current/target))/rate;
    if (stop<dt) { auto next=angular(0,target,response,dt-stop); return {next.rate,current/rate+target*stop+next.angle}; }
  }
  double change=-std::expm1(-rate*dt);
  return {current+(target-current)*change,target*dt+(current-target)*change/rate};
}

class Flight {
  State& s; const Params& f; const Controls& c; Wind& wind; Impact& impact; bool nativeHeight;
  V pos, vel, w, endpoint, hold, previous, load, lastLoad;
  Q q;
  double raw(double x, double z) const { return nativeHeight ? max(10.,terrain::groundHeight(x,z)) : height_at(x,z); }
  double ground(double x, double z) const { double h=raw(x,z); return max(10.,std::isfinite(h)?h:0.); }
  double along(V v) const { return v.x*sin(s.heading)-v.z*cos(s.heading); }
  V sample(double t) const {
    double phase=wind.seed*2.399963;
    double gust=wind.gust>0 ? (0.5*sin(TAU*t/7.3+phase*1.618)+0.3*sin(TAU*t/3.1+phase*2.618)+0.2*sin(TAU*t/1.7+phase*3.618)+1)/2 : 0;
    double speed=wind.speed+wind.gust*gust;
    double direction=wrap(wind.direction+(wind.veer>0 ? wind.veer*(0.6*sin(TAU*t/11.9+(phase+1)*1.618)+0.4*sin(TAU*t/4.3+(phase+1)*2.618)) : 0));
    V v{speed ? -sin(direction)*speed : 0,0,speed ? cos(direction)*speed : 0};
    double k=wind.blending ? clamp((t-wind.start)/6,0,1) : 1; k=k*k*(3-2*k);
    if (k<1) { v.x=mix(wind.fromX,v.x,k); v.z=mix(wind.fromZ,v.z,k); }
    return v;
  }
  V advanceWind(double dt) {
    V before=endpoint; w=sample(wind.time+dt/2); endpoint=sample(wind.time+dt);
    wind.time+=dt; if(wind.blending && wind.time-wind.start>=6) wind.blending=0;
    return before;
  }
  void setQuaternion() { q=Q::euler(s.pitch,-s.heading,-s.bank); seen(); }
  void seen() { s.seen_0=s.pitch; s.seen_1=s.bank; s.seen_2=s.heading; }
  void readAttitude() {
    double xx=q.x*2*q.x, yy=q.y*2*q.y, zz=q.z*2*q.z, xy=q.x*2*q.y, xz=q.x*2*q.z,
      yz=q.y*2*q.z, wx=q.w*2*q.x, wy=q.w*2*q.y, wz=q.w*2*q.z, m23=yz-wx;
    s.pitch=std::asin(-clamp(m23,-1,1));
    if(abs(m23)<0.9999999) { s.heading=wrap(-std::atan2(xz+wy,1-(xx+yy))); s.bank=-std::atan2(xy+wz,1-(xx+zz)); }
    else { s.heading=wrap(-std::atan2(-(xz-wy),1-(yy+zz))); s.bank=0; }
    seen();
  }
  void record() {
    impact={1,0,pos.x,pos.y,pos.z,f.rotorcraft ? std::hypot(vel.x,vel.z) : s.speed,abs(s.verticalSpeed),
      s.heading,s.bank,s.pitch,s.gearDown,s.flaps,s.stalled,s.flightTime};
  }
  void sampleLoad(double dt, V acceleration) {
    if(s.loadElapsed==0) load=previous;
    s.loadElapsed+=dt;
    bool resolved=s.loadElapsed>=1e-6;
    if(resolved || s.loadPreviousElapsed>0) {
      double elapsed=resolved ? s.loadElapsed : s.loadPreviousElapsed+s.loadElapsed;
      acceleration=(acceleration-(resolved?load:lastLoad))*(1/elapsed); acceleration.y+=G;
      s.gForce=acceleration.dot(q.apply({0,1,0}))/G;
    }
    if(resolved) { lastLoad=load; s.loadPreviousElapsed=s.loadElapsed; s.loadElapsed=0; }
  }
  void steerFree(double dt, V rotation) {
    if(s.pitch!=s.seen_0 || s.bank!=s.seen_1 || s.heading!=s.seen_2) setQuaternion();
    Q prev=q;
    if(s.autopilot) {
      double pitch=clamp(((s.holdAltitude-pos.y)*0.002-s.verticalSpeed*0.013)*f.autopilotGain,-0.16,0.16);
      double bank=clamp(angleError(s.holdHeading,s.heading)*1.6,-0.4,0.4);
      if(s.recovering) pitch=bank=0;
      Q target=Q::euler(pitch,-s.heading,-bank); double angle=q.angleTo(target);
      if(s.recovering && angle<0.05) { s.recovering=0; s.holdAltitude=pos.y; s.holdHeading=s.headingHold ? s.selectedHeading*PI/180 : s.heading; }
      q=q.towards(target,min(angle*(1-exp(-(s.recovering ? 3 : 1)*dt)),1.2*dt));
      s.pitchRate=damp(s.pitchRate,0,5,dt); s.rollRate=damp(s.rollRate,0,5,dt);
    } else {
      double angle=rotation.length(); if(angle>0) q=q*Q::axisAngle(rotation*(1/angle),angle);
    }
    q=q.normalized(); Q delta=Q{-prev.x,-prev.y,-prev.z,prev.w}*q; double sign=delta.w<0 ? -2/dt : 2/dt;
    s.bodyRates_pitch=delta.x*sign; s.bodyRates_yaw=-delta.y*sign; s.bodyRates_roll=-delta.z*sign;
    readAttitude();
  }
  void dropNose(double amount) {
    V forward=q.apply({0,0,-1}); double pitch=std::asin(clamp(forward.y,-1,1)); if(pitch<=-0.25) return;
    V axis=forward.cross({0,-1,0}); if(axis.dot(axis)<1e-6) axis=q.apply({1,0,0});
    q=(Q::axisAngle(axis.normalized(),(pitch+0.25)*amount)*q).normalized();
  }
  void turnFree(double dt) {
    V up=q.apply({0,1,0}); double side=-q.apply({1,0,0}).y;
    double gain=up.y>=0.35 ? 1/up.y : up.y>0 ? 1+up.y*(1/0.35-1)/0.35 : 1;
    double rate=G*side*gain/max(s.speed,24.);
    q=(Q::axisAngle({0,1,0},-rate*dt)*q).normalized();
  }
  void stepGround(double dt, double burner) {
    s.gForce=1; s.loadElapsed=s.loadPreviousElapsed=0;
    double target=s.spool>0.2 ? (s.spool-0.2)*f.groundThrust+burner : 0;
    double next=damp(s.speed,target,s.spool<0.2 ? 0.35 : f.groundRate,dt);
    s.speed=f.maxAcceleration ? min(next,s.speed+f.maxAcceleration*dt) : next;
    s.brake=c.brake; if(s.brake>0) s.speed=max(0.,s.speed-s.brake*f.brakeDeceleration*dt);
    s.heading=wrap(s.heading+(c.yaw+c.roll*0.6)*dt*0.35);
    s.bank=damp(s.bank,0,5,dt); s.pitch=damp(s.pitch,max(0.,c.pitch)*0.12,3,dt);
    double distance=s.speed*dt; pos.x+=sin(s.heading)*distance; pos.z-=cos(s.heading)*distance;
    pos.y=ground(pos.x,pos.z)+f.groundClearance; s.distance+=distance;
    double airspeed=s.speed-along(w);
    if(airspeed>f.rotateSpeed-s.flaps*f.flapStallGain && c.pitch>0.15) {
      s.grounded=0; s.speed=max(0.,airspeed); s.pitch=f.aerobatic ? max(s.pitch,0.10) : 0.10;
      s.verticalSpeed=2.5; pos.y+=0.5;
    }
  }
  void fixedWing(double dt) {
    previous=q.apply({0,0,-s.speed}); previous.y=s.verticalSpeed; previous.x+=endpoint.x; previous.z+=endpoint.z;
    V before=advanceWind(dt);
    if(!s.grounded) { double change=((endpoint.x-before.x)*sin(s.heading)-(endpoint.z-before.z)*cos(s.heading))*cos(s.pitch); if(change) s.speed=max(0.,s.speed-change); }
    s.flightTime+=dt; s.brake=0; s.throttle=clamp(s.throttle+c.throttle*dt*f.throttleRate,0,1);
    s.spool=damp(s.spool,s.throttle,s.spool<0.35 ? f.spoolUp : f.spoolCruise,dt);
    s.afterburner=f.afterburnerFrom>=0 && s.throttle>=f.afterburnerFrom && s.spool>f.afterburnerFrom-0.05;
    double trimBefore=s.pitchTrim;
    if(c.trim && !f.aerobatic) s.pitchTrim=clamp(s.pitchTrim+c.trim*(2*PI/180)*dt,-8*PI/180,8*PI/180);
    double burner=s.afterburner ? clamp((s.spool-f.afterburnerFrom+0.05)/(1.05-f.afterburnerFrom),0,1)*f.afterburnerSpeed : 0;
    auto pitch=angular(s.pitchRate,c.pitch*f.pitchRate,f.pitchResponse,dt), roll=angular(s.rollRate,c.roll*f.rollRate,f.rollResponse,dt), yaw=angular(s.yawRate,c.yaw*f.yawRate,f.yawResponse,dt);
    s.pitchRate=pitch.rate; s.rollRate=roll.rate; s.yawRate=yaw.rate;
    bool free=f.aerobatic && !s.grounded;
    if(free) steerFree(dt,{pitch.angle,-yaw.angle,-roll.angle});
    else if(s.autopilot) {
      double desired=clamp(((s.holdAltitude-pos.y)*0.002-s.verticalSpeed*0.013)*f.autopilotGain,-0.16,0.16);
      s.pitch=damp(s.pitch,desired,0.85,dt); s.bank=damp(s.bank,clamp(angleError(s.holdHeading,s.heading)*1.6,-0.4,0.4),1.1,dt);
      s.pitchRate=damp(s.pitchRate,0,5,dt); s.rollRate=damp(s.rollRate,0,5,dt);
    } else {
      s.pitch+=pitch.angle; s.bank+=roll.angle;
      s.bank=damp(s.bank,0,0.17*clamp((0.1-abs(c.roll))/0.05,0,1),dt);
      double stick=clamp((0.1-abs(c.pitch))/0.05,0,1);
      double trim=(f.glidePitch ? -f.glidePitch*clamp(1-s.spool/0.32,0,1) : 0)+(s.grounded ? 0 : s.pitchTrim);
      double turned=s.grounded ? 0 : (s.pitchTrim-trimBefore)*stick;
      if(turned>0 && s.pitch<trim) s.pitch=min(trim,s.pitch+turned); else if(turned<0 && s.pitch>trim) s.pitch=max(trim,s.pitch+turned);
      s.pitch=damp(s.pitch,trim,0.045*stick,dt);
    }
    if(!free) {
      if(!f.aerobatic) { s.pitch=clamp(s.pitch,f.pitchMin,f.pitchMax); s.bank=clamp(s.bank,-f.bankLimit,f.bankLimit); }
      s.bodyRates_pitch=s.bodyRates_roll=s.bodyRates_yaw=0;
    }
    if(s.grounded) { s.stalled=0; stepGround(dt,burner); setQuaternion(); return; }
    double thrust=f.idleSpeed+s.spool*f.thrustSpeed+burner;
    double target=clamp(thrust-s.flaps*f.flapDrag-(s.gearDown?f.gearDrag:0)-abs(sin(s.bank))*f.bankDrag-max(0.,sin(s.pitch))*f.climbDrag+max(0.,-sin(s.pitch))*f.diveGain,f.minSpeed,f.maxSpeed);
    double next=damp(s.speed,target,f.speedRate,dt); s.speed=f.maxAcceleration ? min(next,s.speed+f.maxAcceleration*dt) : next;
    double loadDemand=!f.aerobatic && abs(s.bank)<PI/2 ? 1/max(0.5,cos(s.bank)) : 1;
    double stall=(f.stallSpeed-s.flaps*f.flapStallGain)*sqrt(loadDemand);
    s.stalled=s.speed<stall; double amount=clamp((stall+4-s.speed)/12,0,1);
    if(s.stalled) { if(free) dropNose(1-exp(-(0.7+amount)*dt)); else s.pitch=damp(s.pitch,-0.25,0.7+amount,dt); s.autopilot=0; }
    double idleSink=max(0.,0.32-s.spool)*f.idleSink, lowSink=amount*amount*8, turnSink=abs(sin(s.bank))*0.9;
    if(free) {
      turnFree(dt); V forward=q.apply({0,0,-1});
      s.verticalSpeed=damp(s.verticalSpeed,forward.y*s.speed-idleSink-lowSink-turnSink,8,dt);
      double dx=forward.x*s.speed*dt+w.x*dt, dz=forward.z*s.speed*dt+w.z*dt;
      pos=pos+V{dx,s.verticalSpeed*dt,dz};
      s.distance+=(w.x||w.z) ? std::hypot(dx,dz) : std::hypot(forward.x,forward.z)*s.speed*dt;
    } else {
      s.heading=wrap(s.heading+G*std::tan(s.bank)/max(s.speed,24.)*dt+yaw.angle);
      s.verticalSpeed=damp(s.verticalSpeed,sin(s.pitch)*s.speed-idleSink-lowSink-turnSink,2.1,dt);
      double distance=cos(s.pitch)*s.speed*dt, dx=sin(s.heading)*distance+w.x*dt, dz=-cos(s.heading)*distance+w.z*dt;
      pos=pos+V{dx,s.verticalSpeed*dt,dz}; s.distance+=(w.x||w.z) ? std::hypot(dx,dz) : distance;
      setQuaternion();
    }
    V acceleration=q.apply({0,0,-s.speed}); acceleration.y=s.verticalSpeed; acceleration.x+=endpoint.x; acceleration.z+=endpoint.z;
    sampleLoad(dt,acceleration);
    double surface=ground(pos.x,pos.z)+f.groundClearance;
    if(pos.y<=surface) {
      pos.y=surface; record();
      bool gentle=raw(pos.x,pos.z)>10.2 && s.gearDown && abs(s.verticalSpeed)<f.maxTouchdownSink && s.speed<f.maxTouchdownSpeed && abs(s.bank)<0.3;
      if(gentle) { s.grounded=1; if(w.x||w.z) s.speed=max(0.,s.speed+along(w)); s.gForce=1; s.stalled=0; }
      else { s.crashed=1; impact.reason=s.gearDown ? 1 : 2; s.speed=0; }
      s.verticalSpeed=0; s.autopilot=0;
    }
    if(free) readAttitude();
  }
  void helicopter(double dt) {
    previous=vel; advanceWind(dt); s.flightTime+=dt; s.gearDown=1; s.flaps=0; s.stalled=s.afterburner=0;
    s.throttle=clamp(s.throttle+c.throttle*dt*f.throttleRate,0,1);
    double pt,rt,yt;
    if(s.autopilot) {
      double drag=(w.x||w.z) ? 0.08+std::hypot(w.x,w.z)*0.0012 : 0;
      double ax=clamp((hold.x-pos.x)*0.18-vel.x*0.85-w.x*drag,-3,3), az=clamp((hold.z-pos.z)*0.18-vel.z*0.85-w.z*drag,-3,3);
      double cc=cos(s.heading), h=sin(s.heading);
      pt=(std::atan2(-h*ax+cc*az,G)-s.pitch)*3; rt=(std::atan2(cc*ax+h*az,G)-s.bank)*3;
      yt=clamp(angleError(s.holdHeading,s.heading)*1.5,-f.yawRate,f.yawRate);
      double va=clamp((s.holdAltitude-pos.y)*0.36-vel.y*0.95,-3,3), collective=f.hoverCollective*(1+va/G);
      double target=clamp(collective+(collective-s.spool)/f.collectiveResponse,0.2,0.9);
      s.throttle+=clamp(target-s.throttle,-2*f.throttleRate*dt,2*f.throttleRate*dt);
    } else {
      pt=c.pitch*f.pitchRate-s.pitch*f.levelRate*(1-abs(c.pitch)); rt=c.roll*f.rollRate-s.bank*f.levelRate*(1-abs(c.roll)); yt=c.yaw*f.yawRate;
    }
    double pl=s.autopilot ? 1.8 : f.pitchRate, rl=s.autopilot ? 1.8 : f.rollRate;
    auto pitch=angular(s.pitchRate,clamp(pt,-pl,pl),s.autopilot ? 12 : f.pitchResponse,dt), roll=angular(s.rollRate,clamp(rt,-rl,rl),s.autopilot ? 12 : f.rollResponse,dt), yaw=angular(s.yawRate,yt,f.yawResponse,dt);
    s.pitchRate=pitch.rate; s.rollRate=roll.rate; s.yawRate=yaw.rate;
    s.pitch=clamp(s.pitch+pitch.angle,f.pitchMin,f.pitchMax); s.bank=clamp(s.bank+roll.angle,-f.bankLimit,f.bankLimit);
    if(!s.grounded) s.heading=std::fmod(s.heading+yaw.angle+TAU,TAU);
    setQuaternion(); s.bodyRates_pitch=s.pitchRate; s.bodyRates_roll=s.rollRate; s.bodyRates_yaw=s.yawRate;
    s.spool=damp(s.spool,s.throttle,f.collectiveResponse,dt);
    s.rotorSpeed=damp(s.rotorSpeed,s.throttle>0.02 ? 1 : 0,s.throttle>0.02 ? f.rotorSpinUp : f.rotorSpinDown,dt);
    V up=q.apply({0,1,0}); double lift=G*s.spool/f.hoverCollective*s.rotorSpeed*s.rotorSpeed/max(0.6,up.y);
    if(s.grounded) {
      vel={}; s.speed=s.verticalSpeed=0; s.gForce=1; s.pitch=s.bank=0; s.pitchRate=s.rollRate=s.yawRate=0;
      s.bodyRates_pitch=s.bodyRates_roll=s.bodyRates_yaw=0; up={0,1,0}; pos.y=ground(pos.x,pos.z)+f.groundClearance; setQuaternion();
      if(lift>G+0.15) { s.grounded=0; pos.y+=0.02; } else return;
    }
    double airX=vel.x-w.x, airZ=vel.z-w.z, drag=0.08+std::hypot(airX,airZ)*0.0012;
    vel.x+=(up.x*lift-airX*drag)*dt; vel.z+=(up.z*lift-airZ*drag)*dt; vel.y+=(up.y*lift-G-vel.y*0.8)*dt;
    pos=pos+vel*dt; s.distance+=std::hypot(vel.x,vel.z)*dt; s.speed=(vel-w).length(); s.verticalSpeed=vel.y;
    V acceleration=(vel-previous)*(1/dt); acceleration.y+=G; s.gForce=acceleration.dot(up)/G;
    double surface=ground(pos.x,pos.z)+f.groundClearance;
    if(pos.y<=surface) {
      double penetration=surface-pos.y; pos.y=surface; record();
      double lo=1e300, hi=-1e300;
      for(int x : {-1,1}) for(int z : {-1,1}) { double h=ground(pos.x+x*f.footprintX,pos.z+z*f.footprintZ); lo=min(lo,h); hi=max(hi,h); }
      bool water=raw(pos.x,pos.z)<=10.2;
      bool gentle=!water && hi-lo<0.8 && penetration<0.3 && abs(vel.y)<f.maxTouchdownSink && std::hypot(vel.x,vel.z)<f.maxTouchdownSpeed && abs(s.bank)<0.22 && abs(s.pitch)<0.22;
      s.grounded=gentle; s.crashed=!gentle; impact.reason=gentle ? 0 : water ? 3 : 1; s.autopilot=0;
      s.speed=s.verticalSpeed=0; if(gentle) s.gForce=1; vel={};
    }
  }
public:
  Flight(State& s,const Params& f,const Controls& c,Wind& wind,Impact& impact,bool nativeHeight):s(s),f(f),c(c),wind(wind),impact(impact),nativeHeight(nativeHeight),
    pos{s.position_x,s.position_y,s.position_z},vel{s.velocity_x,s.velocity_y,s.velocity_z},w{s.windVelocity_x,0,s.windVelocity_z},endpoint{s.windEndpoint_x,0,s.windEndpoint_z},hold{s.holdPosition_x,s.holdPosition_y,s.holdPosition_z},
    load{s.loadVelocity_x,s.loadVelocity_y,s.loadVelocity_z},lastLoad{s.loadPreviousVelocity_x,s.loadPreviousVelocity_y,s.loadPreviousVelocity_z},q{s.quaternion_x,s.quaternion_y,s.quaternion_z,s.quaternion_w} {}
  void update(double dt) {
    impact.contact=0;
    if(s.crashed || !std::isfinite(dt) || dt<=0) return;
    double elapsed=min(dt,0.25); int steps=max(1,int(std::ceil(elapsed/0.025)));
    if(abs(c.pitch)+abs(c.roll)+abs(c.yaw)>(f.rotorcraft ? 0.001 : 0.12) || (f.rotorcraft && abs(c.throttle)>0.001)) s.autopilot=0;
    for(int i=0;i<steps && !s.crashed;i++) {
      if(f.rotorcraft) helicopter(elapsed/steps); else fixedWing(elapsed/steps);
      s.airspeed=f.rotorcraft ? (s.grounded ? std::hypot(w.x,w.z) : s.speed) : (s.grounded ? max(0.,s.speed-along(w)) : s.speed);
    }
    if(!s.autopilot) s.headingHold=0;
    s.position_x=pos.x; s.position_y=pos.y; s.position_z=pos.z;
    s.quaternion_x=q.x; s.quaternion_y=q.y; s.quaternion_z=q.z; s.quaternion_w=q.w;
    s.velocity_x=vel.x; s.velocity_y=vel.y; s.velocity_z=vel.z;
    s.windVelocity_x=w.x; s.windVelocity_z=w.z; s.windEndpoint_x=endpoint.x; s.windEndpoint_z=endpoint.z;
    s.loadVelocity_x=load.x; s.loadVelocity_y=load.y; s.loadVelocity_z=load.z;
    s.loadPreviousVelocity_x=lastLoad.x; s.loadPreviousVelocity_y=lastLoad.y; s.loadPreviousVelocity_z=lastLoad.z;
  }
};
// One reusable call workspace; controllers retain their own state in JS. Calls
// are synchronous and upload/download once per frame, including every substep.
static State state;
static Params params;
static Controls controls;
static Wind wind;
static Impact impact;
constexpr int GRID_CAPACITY=16384;
static double heights[GRID_CAPACITY];
extern "C" {
int abi_version() { return 1; }
State* flight_state() { return &state; }
Params* flight_params() { return &params; }
Controls* flight_controls() { return &controls; }
Wind* flight_wind() { return &wind; }
Impact* flight_impact() { return &impact; }
void flight_update(double dt,int nativeHeight) { Flight(state,params,controls,wind,impact,nativeHeight).update(dt); }
double terrain_height(double x,double z) { return terrain::groundHeight(x,z); }
double* height_buffer() { return heights; }
int height_grid(double x,double z,double dx,double dz,int width,int height,int water,int indexX,int indexZ,int stride) {
  if(width<=0 || height<=0 || width>GRID_CAPACITY/height) return 0;
  for(int j=0;j<height;j++) for(int i=0;i<width;i++) {
    double h=terrain::groundHeight(x+(indexX+i*stride)*dx,z+(indexZ+j*stride)*dz); heights[j*width+i]=water ? max(10.,h) : h;
  }
  return width*height;
}
}
