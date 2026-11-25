/* LyFan: expresiones, animación Canvas/WebGL e interacción.
   Independiente de Codex: el estado se guarda únicamente en este navegador. */

(()=>{
  const root=document.getElementById('lyfan-unified');
  const canvas=root.querySelector('canvas');
  const legacyCanvas=document.createElement('canvas');
  const stage=root.querySelector('.pet-stage');
  const phrase=root.querySelector('.pet-phrase');
  const status=root.querySelector('.pet-status-text');
  const motion=root.querySelector('.pet-motion input');
  const hit=root.querySelector('.pet-hit');
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const buttons=[...root.querySelectorAll('[data-pose]')];
  const atlas=root.querySelector('.pet-source');
  const kawaii=atlas;
  const actionAtlas=atlas;
  const analysisAtlas=root.querySelector('.pet-analysis-source');
  const extraAtlas=root.querySelector('.pet-extra-source');
  const bodyAtlas=root.querySelector('.pet-body-source');
  const workAtlas=root.querySelector('.pet-work-source');
  const dreamButtons=[...root.querySelectorAll('.pet-dream-z')];
  const poses={
    idle:{index:0,tile:[0,0],left:[230,193],right:[317,192],antenna:[296,27],phrase:'Hola, soy LyFan. ¿Revisamos juntos?',status:'En reposo · atento a ti',color:'#71ddc5'},
    scan:{index:2,tile:[0,0],left:[148,193],right:[236,192],antenna:[214,27],phrase:'Activando escáner… déjame mirar de cerca.',status:'Modo detective · escaneando',color:'#86c9df'},
    alert:{index:3,tile:[0,1],left:[232,198],right:[323,194],antenna:[297,30],phrase:'¡Alto ahí! Yo protejo este equipo.',status:'Alerta · firme y protegiéndote',color:'#e9b773'},
    sleep:{index:4,tile:[1,1],left:[0,0],right:[0,0],antenna:[290,62],phrase:'Zzz… cinco minutitos más.',status:'Soñando · toca las z para hacerle cosquillas',color:'#ed8b87'},
    happy:{index:5,tile:[0,0],left:[230,193],right:[317,192],antenna:[296,27],phrase:'Jejeje… me encantan las caricias.',status:'Kawaii · acaricia mi cabecita',color:'#a4e6d3'},
    talk:{index:6,tile:[0,0],left:[236,198],right:[322,193],antenna:[310,28],phrase:'Te lo explico con calma, paso a paso.',status:'Hablando · una explicación de LyFan',color:'#87dcca'},
    work:{index:0,tile:[0,0],left:[230,193],right:[317,192],antenna:[296,27],phrase:'Estoy en ello. Lo revisamos paso a paso.',status:'Trabajando · preparando tu respuesta',color:'#83cadb'}
  };
  Object.assign(poses,{
    scanTalk:{...poses.scan,phrase:'Estoy revisando los detalles. Te cuento lo que encuentro.',status:'Analizando y hablando · dos escáneres activos'},
    alertTalk:{...poses.alert,phrase:'He visto algo que debemos revisar. Te explico con cuidado.',status:'Alerta y hablando · firme y atento'},
    workTalk:{...poses.work,speaking:true,phrase:'Sigo trabajando. Te cuento cómo vamos.',status:'Trabajando y hablando · preparando tu respuesta'},
    encrypt:{...poses.idle,phrase:'Estoy cifrando tus archivos. Un momento…',status:'Cifrando y hablando · protección en curso',color:'#7ce6c7'},
    decrypt:{...poses.idle,phrase:'Estoy descifrando tus archivos. Un momento…',status:'Descifrando y hablando · recuperación en curso',color:'#8cd7f5'},
    listen:{...poses.idle,phrase:'Te escucho. Cuéntame qué necesitas.',status:'Escuchando · esperando tu indicación',color:'#8cded7'},
    thinking:{...poses.idle,phrase:'Mmm… déjame pensar un momento.',status:'Pensando · preparando mi respuesta',color:'#96d8d2'},
    curious:{...poses.idle,phrase:'Mmm… ¿qué tenemos por aquí?',status:'Curioso · mirando a su alrededor'},
    wink:{...poses.idle,phrase:'Todo listo. Yo te acompaño.',status:'Guiño · tu pequeño guardián'}
  });
  let state={pose:'listen',motion:!reduced.matches};
  let ready=false,visible=true,renderer=null,animationClock=0,lastTime=0,raf=0,manualBlinkAt=-100;
  let look=[0,0],lastBlink=0,poseStarted=0,micLevel=0;
  let dreamPops=0;
  let petTimer=0,petReturn='idle',pettingAt=-100,lastPetTick=-100,stroke=null;
  let changing=null;
  let rigMoving=false;
  const isCommon=pose=>pose!=='sleep';
  const STORAGE_KEY='lyfan-mascota-plan-a-completa';
  function readSavedState(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');}catch{return null;}}
  function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({modelContent:{mascota:'LyFan animado',estado:state.pose},privateContent:{motion:state.motion}}));}catch{}}
  function restore(saved){if(saved?.modelContent?.estado)state.pose=poses[saved.modelContent.estado]?saved.modelContent.estado:'idle';if(typeof saved?.privateContent?.motion==='boolean')state.motion=saved.privateContent.motion;render();}
  function pulse(x){return x>=0&&x<=1?Math.pow(Math.sin(x*Math.PI),2):0;}
  function blinkNow(now){
    const natural=state.motion&&!reduced.matches?Math.max(pulse((animationClock%3.6-1.35)/.28),pulse((animationClock%7.2-5.8)/.23)):0;
    const manual=pulse((now-manualBlinkAt)/.32);
    return state.pose!=='sleep'?Math.max(natural,manual):0;
  }
  function draw(now){
    const pose=poses[state.pose];
    root.dataset.cipherMode=state.pose==='encrypt'?'encrypt':state.pose==='decrypt'?'decrypt':'none';
    if(!isCommon(state.pose)){root.dataset.speaking='false';root.dataset.mouthOpen='0.000';root.dataset.gestureSymbol='none';root.dataset.starOpacity='0.000';root.dataset.listening='false';}
    lastBlink=blinkNow(now);
    const raw=changing?Math.max(0,Math.min(1,(now-changing.start)/changing.duration)):1;
    const blend=raw*raw*raw*(raw*(raw*6-15)+10);
    if(renderer)renderer.draw(pose,animationClock,lastBlink,state.motion&&!reduced.matches?look:[0,0],blend);
    root.dataset.transition=blend.toFixed(3);
    if(raw>=1)changing=null;
    root.dataset.blink=lastBlink.toFixed(3);
    root.dataset.pose=state.pose;
  }
  function loop(ms){
    raf=0;
    const now=ms/1000;
    const delta=lastTime?Math.min(.25,now-lastTime):0;
    lastTime=now;
    if(state.motion&&!reduced.matches)animationClock+=delta;
    if(ready&&visible)draw(now);
    if(ready&&visible&&((state.motion&&!reduced.matches)||now-manualBlinkAt<.4||changing||rigMoving))raf=requestAnimationFrame(loop);
  }
  function start(){if(!ready)return;draw(performance.now()/1000);if(!raf&&visible){lastTime=0;raf=requestAnimationFrame(loop);}}
  function render(){
    const pose=poses[state.pose];
    root.style.setProperty('--pet-light',pose.color);
    phrase.textContent=pose.phrase;
    status.textContent=pose.status;
    motion.checked=state.motion;
    root.querySelector('.pet-blink').disabled=state.pose==='sleep';
    root.dataset.motion=String(state.motion&&!reduced.matches);
    buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pose===state.pose)));
    hit.setAttribute('aria-label',state.pose==='sleep'?'Despertar a LyFan':'Acariciar a LyFan');
    canvas.setAttribute('aria-label','LyFan: '+pose.status+'.');
    if(!state.motion||state.pose==='sleep')look=[0,0];
    start();
  }
  function choose(pose){
    if(!poses[pose])pose='idle';
    if(pose!=='happy')clearTimeout(petTimer);
    if(pose===state.pose){render();save();return;}
    if(pose!==state.pose&&ready&&!reduced.matches&&renderer.capture&&(!(isCommon(pose)&&isCommon(state.pose))||changing)){renderer.capture();changing={start:performance.now()/1000,duration:.58};}
    else if(isCommon(pose)&&isCommon(state.pose))changing=null;
    else if(reduced.matches)changing=null;
    renderer?.retarget?.();
    state.pose=pose;poseStarted=animationClock;dreamPops=0;render();document.dispatchEvent(new CustomEvent('lyfan:pose',{detail:{pose}}));
    if(!reduced.matches)phrase.animate([{opacity:.45,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:280,easing:'ease-out'});
    save();
  }
  function petRobot(){
    if(state.pose==='sleep')return;
    if(state.pose!=='happy')petReturn=state.pose;
    pettingAt=animationClock;lastPetTick=performance.now();
    choose('happy');phrase.textContent='Awww… ¡otra caricia, por favor!';
    clearTimeout(petTimer);petTimer=setTimeout(()=>{if(state.pose==='happy')choose(petReturn==='happy'?'idle':petReturn);},3600);
  }
  function onHead(event){const r=hit.getBoundingClientRect(),x=(event.clientX-r.left)/r.width,y=(event.clientY-r.top)/r.height;return Math.pow((x-.53)/.3,2)+Math.pow((y-.34)/.25,2)<1;}
  root.addEventListener('lyfan:pose',event=>{clearTimeout(petTimer);choose(event.detail?.pose||'idle');});
  root.addEventListener('lyfan:pet',()=>petRobot());
  buttons.forEach(b=>b.addEventListener('click',()=>{clearTimeout(petTimer);choose(b.dataset.pose);}));
      hit.addEventListener('pointerup',()=>{stroke=null;});hit.addEventListener('pointercancel',()=>{stroke=null;});
  hit.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();petRobot();}});
  motion.addEventListener('change',()=>{state.motion=motion.checked;render();save();});
  root.querySelector('.pet-blink').addEventListener('click',()=>{if(state.pose==='sleep')return;manualBlinkAt=performance.now()/1000;start();});
  root.querySelectorAll('.pet-alert-mark').forEach(b=>b.addEventListener('click',()=>{phrase.textContent='Tranquilo, lo revisamos juntos. Estoy contigo.';}));
  dreamButtons.forEach(button=>button.addEventListener('click',()=>{
    if(state.pose!=='sleep')return;
    dreamPops++;
    button.classList.remove('pet-popped');void button.offsetWidth;button.classList.add('pet-popped');
    setTimeout(()=>button.classList.remove('pet-popped'),520);
    if(dreamPops>=3){choose('idle');phrase.textContent='¡Ya desperté! ¿Me estabas haciendo cosquillas?';}
    else phrase.textContent=dreamPops===1?'Mmm… ¿quién anda tocando mis sueños?':'Jeje… ¡eso hace cosquillas!';
  }));
  stage.addEventListener('pointermove',event=>{if(!state.motion||state.pose==='sleep'||reduced.matches)return;const r=stage.getBoundingClientRect();look=[Math.max(-1,Math.min(1,(event.clientX-r.left-r.width/2)/(r.width/2))),Math.max(-1,Math.min(1,(event.clientY-r.top-r.height/2)/(r.height/2)))];});
  stage.addEventListener('pointerleave',()=>{look=[0,0];});
  reduced.addEventListener('change',()=>render());
  restore(readSavedState());
  const vertex=`
    precision highp float;
    precision highp int;
    attribute vec2 aPosition;
    uniform float uTime;
    uniform float uBlink;
    uniform int uPose;
    uniform vec2 uEyeL;
    uniform vec2 uEyeR;
    uniform vec2 uLook;
    uniform float uChange;
    varying vec2 vUv;
    vec2 rotatePoint(vec2 p,vec2 pivot,float angle){float c=cos(angle),s=sin(angle);vec2 d=p-pivot;return pivot+vec2(c*d.x-s*d.y,s*d.x+c*d.y);}
    void main(){
      vUv=aPosition/512.0;
      vec2 p=aPosition;
      if(uPose==1){
        float w=smoothstep(358.0,378.0,p.x)*(1.0-smoothstep(281.0,327.0,p.y));
        float angle=sin(uTime*6.2)*.17;
        p+=w*(rotatePoint(p,vec2(397.0,276.0),angle)-p);
      }
      if(uPose==2){
        float w=smoothstep(347.0,374.0,p.x)*(1.0-smoothstep(370.0,397.0,p.y));
        float a=sin(uTime*1.9)*.045;
        vec2 target=rotatePoint(p,vec2(383.0,335.0),a)+vec2(sin(uTime*1.4)*1.0,cos(uTime*1.9)*1.5);
        p+=w*(target-p);
      }
      if(uPose==5){
        p=rotatePoint(p,vec2(255.0,451.0),sin(uTime*1.7)*.009);
      }
      if(uPose==7){
        float hand=smoothstep(196.0,209.0,p.x)*(1.0-smoothstep(270.0,283.0,p.x))*smoothstep(343.0,355.0,p.y)*(1.0-smoothstep(389.0,401.0,p.y));
        p.y-=hand*(1.8+2.0*sin(uTime*11.0+(p.x-213.0)*.13));
      }
      if(uPose==0||uPose==4)p.y-=sin(uTime*(uPose==4?1.0:1.65))*.6;
      p+=uLook*.5;
      if(uPose==1)p=(p-vec2(205.0,200.0))*.95+vec2(272.0,200.0);
      if(uPose==2)p=(p-vec2(195.0,204.0))*.95+vec2(272.0,204.0);
      p.y+=sin(uChange*3.14159265)*2.8;
      gl_Position=vec4((p.x-256.0)/288.0,(256.0-p.y)/288.0,0.0,1.0);
    }
  `;
  const fragment=`
    precision highp float;
    precision highp int;
    uniform sampler2D uAtlas;
    uniform sampler2D uHappy;
    uniform sampler2D uActions;
    uniform sampler2D uExtras;
    uniform vec2 uTile;
    uniform int uPose;
    uniform float uBlink;
    uniform vec2 uEyeL;
    uniform vec2 uEyeR;
    uniform vec2 uAntenna;
    uniform float uTime;
    varying vec2 vUv;
    vec4 sourceAt(vec2 p){
      if(uPose==6||uPose==7)return texture2D(uExtras,(vec2(float(uPose-6),0.0)+p/512.0)/vec2(2.0,1.0));
      if(uPose==5){
        vec2 uv=(p/512.0-vec2(.03,.0))/.94;
        if(uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0)return vec4(0.0);
        return texture2D(uHappy,uv);
      }
      if(uPose==1||uPose==2)return texture2D(uActions,(vec2(float(uPose-1),0.0)+p/512.0)/vec2(2.0,1.0));
      return texture2D(uAtlas,(uTile+p/512.0)/vec2(3.0,2.0));
    }
    float eyeLight(vec4 c){return smoothstep(.025,.11,c.g-c.r)*smoothstep(.02,.10,c.b-c.r)*smoothstep(.15,.45,c.g);}
    vec4 closeEye(vec4 c,vec2 pixel,vec2 center,float direction){
      vec2 d=pixel-center;
      float region=(1.0-smoothstep(27.0,34.0,abs(d.x)))*(1.0-smoothstep(29.0,39.0,abs(d.y)));
      float strength=smoothstep(.0,.12,uBlink);
      vec4 glass=sourceAt(vec2(center.x+direction*36.0,pixel.y));
      if(uPose==5)glass=sourceAt(vec2(260.0,145.0));
      vec4 cleared=mix(c,glass,eyeLight(c)*region*strength);
      float sourceY=d.y/max(.035,1.0-uBlink*.965);
      vec4 squeezed=sourceAt(vec2(pixel.x,center.y+sourceY));
      float inside=1.0-smoothstep(27.0,36.0,abs(sourceY));
      return mix(cleared,squeezed,eyeLight(squeezed)*region*inside*strength);
    }
    void main(){
      vec4 color=sourceAt(vUv*512.0);
      if(uBlink>0.0&&uPose!=4&&uPose!=7){
        color=closeEye(color,vUv*512.0,uEyeL,1.0);
        color=closeEye(color,vUv*512.0,uEyeR,-1.0);
      }
      vec2 pixel=vUv*512.0;
      if((uPose==1||uPose==2||uPose==6||uPose==7)&&(pixel.x<4.0||pixel.x>508.0))color=vec4(0.0);
      if(uPose==2){
        vec2 face=pixel-vec2(195.0,204.0);
        vec2 q=abs(face)-vec2(106.0,68.0)+vec2(35.0);
        float sdf=length(max(q,0.0))+min(max(q.x,q.y),0.0)-35.0;
        float faceMask=1.0-smoothstep(-1.0,1.0,sdf);
        float scanY=sin(uTime*1.7)*56.0;
        float line=exp(-pow((face.y-scanY)/2.0,2.0));
        float trail=exp(-pow((face.y-scanY+6.0)/10.0,2.0))*.10;
        color.rgb+=vec3(.22,.75,.78)*(line*.67+trail)*faceMask*color.a;
      }
      if(uPose==3){
        float shield=smoothstep(303.0,320.0,pixel.x)*(1.0-smoothstep(393.0,405.0,pixel.y))*smoothstep(253.0,269.0,pixel.y);
        float streak=exp(-pow((pixel.x+.35*pixel.y-(390.0+sin(uTime*1.8)*45.0))/8.0,2.0));
        color.rgb+=vec3(.12,.28,.22)*shield*streak*color.a;
      }
      if(uPose==4){
        vec2 mouth=pixel-vec2(267.0,279.0);
        float mouthMask=1.0-smoothstep(16.0,21.0,length(mouth));
        vec4 glass=sourceAt(vec2(pixel.x,255.0+mouth.y*.12));
        color=mix(color,glass,mouthMask);
      }
      if(uPose==5){
        vec2 mouth=pixel-vec2(267.0,208.0);
        float laugh=.62+.38*abs(sin(uTime*4.4));
        float mouthMask=1.0-smoothstep(1.0,1.25,length(mouth/vec2(27.0,23.0)));
        vec2 mouthUV=vec2(267.0,208.0)+mouth/vec2(.99+.03*cos(uTime*4.4),laugh);
        color=mix(color,sourceAt(mouthUV),mouthMask);
      }
      if(uPose==6){
        vec2 mouth=pixel-vec2(282.0,231.0);
        float syllable=clamp(.5+.34*sin(uTime*8.8)+.16*sin(uTime*15.0),0.0,1.0);
        vec2 articulated=mouth/vec2(.68+.32*syllable,.18+.82*syllable);
        vec4 speaking=sourceAt(vec2(282.0,231.0)+articulated);
        if(abs(articulated.y)>18.0||abs(articulated.x)>22.0)speaking=sourceAt(vec2(282.0,210.0));
        float mask=1.0-smoothstep(1.0,1.35,length(mouth/vec2(18.0,17.0)));
        color=mix(color,speaking,mask);
      }
      if(uPose==7){
        float keyboard=smoothstep(208.0,222.0,pixel.x)*(1.0-smoothstep(281.0,296.0,pixel.x))*smoothstep(385.0,392.0,pixel.y)*(1.0-smoothstep(404.0,409.0,pixel.y));
        float keys=pow(max(0.0,sin((pixel.x-205.0)*.4+uTime*8.0)),6.0);
        color.rgb+=vec3(.02,.13,.12)*keyboard*keys*color.a;
      }
      vec3 lamp=uPose==4?vec3(1.0,.18,.16):(uPose==3?vec3(1.0,.65,.22):(uPose==2?vec3(.38,.86,1.0):vec3(.4,1.0,.82)));
      float beat=.5+.5*sin(uTime*(uPose==4?1.55:(uPose==5?5.4:3.2)));
      vec2 lampDelta=pixel-uAntenna;
      float lampDistance=length(lampDelta);
      float core=1.0-smoothstep(8.0,20.0,lampDistance);
      color.rgb*=1.0+(beat-.5)*(uPose==5?.9:.55)*core;
      float halo=exp(-dot(lampDelta,lampDelta)/(uPose==5?230.0:170.0))*(.03+.18*beat);
      color.rgb+=halo*lamp*(1.0-color.a);
      color.a+=halo*(1.0-color.a);
      gl_FragColor=color;
    }
  `;
  function makeSharedRenderer(legacy){
    const output=canvas.getContext('2d',{alpha:true});
    const frame=document.createElement('canvas'),previous=document.createElement('canvas');
    const painter=frame.getContext('2d'),previousPainter=previous.getContext('2d');
    let allocated=0,hasSnapshot=false,lastRigTime=performance.now(),firstRigFrame=false,holdRigUntil=0;
    const neutral={rs:0,re:0,ls:0,le:0,open:0,leftOpen:0,rh:3.14,lh:3.14,lens:0,shield:0,happy:0,alert:0,talk:0,scan:0,gesture:0,curious:0,wink:0,listen:0,cipher:0,unlock:0,work:0,thinking:0,r:114,g:236,b:207};
    const rig={...neutral};
    const target={
      idle:{},
      scan:{rs:-.8,re:-.35,rh:0,lens:1,scan:1,r:131,g:218,b:246},
      alert:{rs:-.3,re:-.55,rh:0,shield:1,alert:1,r:255,g:155,b:106},
      happy:{rs:-.85,re:-.3,ls:.85,le:.3,rh:1.15,lh:-1.15,open:.65,leftOpen:.65,happy:1},
      talk:{rs:-.65,re:-.35,open:.65,rh:1.15,talk:1,gesture:1}
    };
    target.scanTalk={...target.scan,talk:1};
    target.alertTalk={...target.alert,talk:1};
    target.curious={curious:1};
    target.wink={wink:1};
    target.listen={listen:1,r:140,g:222,b:215};
    target.encrypt={cipher:1,talk:1,r:124,g:230,b:199};
    target.decrypt={cipher:1,unlock:1,talk:1,r:140,g:215,b:245};
    target.thinking={thinking:1,r:150,g:216,b:210};
    target.work={work:1,r:131,g:218,b:246};
    target.workTalk={...target.work,talk:1};
    const point=(x,y)=>({x,y});
    const left={s:point(188,306),e:point(164,338),w:point(157,359)};
    const right={s:point(340,306),e:point(359,338),w:point(366,358)};
    function tile(ctx,img,col=0,row=0,cols=3,rows=2){ctx.drawImage(img,col*img.naturalWidth/cols,row*img.naturalHeight/rows,img.naturalWidth/cols,img.naturalHeight/rows,0,0,512,512);}
    function part(img,path,col=0,row=0,cols=3,rows=2){const c=document.createElement('canvas');c.width=512;c.height=512;const p=c.getContext('2d');p.save();p.clip(typeof path==='string'?new Path2D(path):path);tile(p,img,col,row,cols,rows);p.restore();return c;}
    const pieces={
      shield:part(atlas,'M365 251 Q393 265 425 278 L420 338 Q411 376 365 403 Q319 381 309 340 L303 282Z',0,1)
    };
    function rotate(x,y,a){return point(x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a));}
    const normalLeft=part(atlas,'M183 283 Q164 292 151 314 Q145 325 142 348 L136 355 Q131 380 144 397 Q158 414 179 403 Q195 399 191 373 L207 335 L217 293 Z');
    const normalRight=part(atlas,'M325 286 L349 287 Q365 309 375 344 Q384 367 381 384 Q379 400 365 403 Q352 405 343 395 L330 333 Z');
    const happyLeft=part(atlas,'M202 280 L165 281 Q147 282 139 280 L128 274 Q115 269 118 281 L126 289 Q111 289 102 295 Q96 301 101 307 L113 308 Q103 309 108 318 L119 320 Q114 325 122 329 Q137 335 155 329 Q181 346 202 332 L211 314 Z',2,1);
    const happyRight=part(atlas,'M331 283 Q352 281 371 284 L389 276 Q405 266 405 278 L396 287 Q412 285 422 293 Q430 300 418 304 Q432 307 425 315 L414 317 Q427 322 416 328 Q400 337 379 328 Q353 344 333 329 L323 310 Z',2,1);
    function integratedPose(kind){
      const c=document.createElement('canvas');c.width=c.height=512;const p=c.getContext('2d');
      if(kind==='scan'){p.drawImage(analysisAtlas,0,0,512,512);return c;}
      if(kind==='work'){p.drawImage(workAtlas,0,0,512,512);return c;}
      p.drawImage(bodyAtlas,0,0,512,512);
      if(kind==='happy'){p.drawImage(happyLeft,-6,1);p.drawImage(happyRight,-2,1);}
      else {p.drawImage(normalLeft,0,0);p.drawImage(normalRight,0,0);}
      return c;
    }
    const photoPoses=[integratedPose('normal'),integratedPose('scan'),integratedPose('happy'),integratedPose('work')];
    const combinedPhoto=document.createElement('canvas');combinedPhoto.width=combinedPhoto.height=512;const combinedPainter=combinedPhoto.getContext('2d');let photoKey='';
    function blendPhoto(){const weights=[Math.max(0,1-rig.scan-rig.happy-rig.work),rig.scan,rig.happy,rig.work];const total=weights.reduce((a,b)=>a+b,0);weights.forEach((v,i)=>weights[i]=v/total);const key=weights.map(v=>v.toFixed(4)).join(',');if(key===photoKey)return false;photoKey=key;combinedPainter.clearRect(0,0,512,512);combinedPainter.globalCompositeOperation='lighter';weights.forEach((w,i)=>{if(w>.0001){combinedPainter.globalAlpha=w;combinedPainter.drawImage(photoPoses[i],0,0);}});combinedPainter.globalAlpha=1;combinedPainter.globalCompositeOperation='source-over';return true;}
    function createPhotoWarp(){
      const c=document.createElement('canvas');c.width=c.height=768;const gl=c.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true});if(!gl)return null;
      const vertexSource=`precision highp float;attribute vec2 p;varying vec2 uv;uniform float clock;uniform vec4 mode;
        float oval(vec2 p,vec2 center,vec2 radius){return 1.-smoothstep(.45,1.,length((p-center)/radius));}
        vec2 turn(vec2 p,vec2 at,float angle){vec2 q=p-at;float c=cos(angle),s=sin(angle);return at+vec2(c*q.x-s*q.y,s*q.x+c*q.y);}
        void main(){uv=p/512.;vec2 q=p;
          float leftHand=oval(p,vec2(163.,382.),vec2(35.,42.))*smoothstep(347.,370.,p.y)*(1.-smoothstep(181.,196.,p.x));
          float rightHand=oval(p,vec2(363.,382.),vec2(33.,42.))*smoothstep(347.,370.,p.y)*smoothstep(340.,353.,p.x);
          float tiny=.013*sin(clock*2.1)+mode.w*.055*sin(clock*2.6);
          q+=turn(p,vec2(163.,355.),tiny)-p;q=mix(p,q,leftHand*(1.-mode.z)*(1.-mode.x));
          q+=rightHand*(1.-mode.x)*(1.-mode.y)*(1.-mode.z)*(turn(p,vec2(364.,355.),-tiny)-p);
          float lh=oval(p,vec2(137.,308.),vec2(44.,40.))*(1.-smoothstep(164.,186.,p.x));
          float rh=oval(p,vec2(395.,308.),vec2(43.,40.))*smoothstep(352.,378.,p.x);
          q+=mode.z*lh*(turn(p,vec2(173.,310.),.035*sin(clock*3.))-p);
          q+=mode.z*rh*(turn(p,vec2(369.,310.),-.035*sin(clock*3.))-p);
          float typingPalm=oval(p,vec2(245.,351.),vec2(39.,28.));
          float typingFingers=oval(p,vec2(264.,356.),vec2(24.,18.));
          float supportPalm=oval(p,vec2(328.,379.),vec2(35.,25.));
          float keyTap=1.65*sin(clock*8.4)+.55*sin(clock*13.2);
          q.y+=mode.x*(typingPalm*.65*sin(clock*5.6)+typingFingers*keyTap+supportPalm*.6*sin(clock*2.1));
          q.x+=mode.x*(typingPalm*.35*sin(clock*4.2)+supportPalm*.25*sin(clock*2.1));
          q+=mode.x*typingPalm*(turn(p,vec2(222.,350.),.018*sin(clock*5.6))-p);
          gl_Position=vec4(q.x/256.-1.,1.-q.y/256.,0.,1.);
        }`;
      function shader(type,s){const a=gl.createShader(type);gl.shaderSource(a,s);gl.compileShader(a);if(!gl.getShaderParameter(a,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(a));return a;}
      const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertexSource));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float;varying vec2 uv;uniform sampler2D image;void main(){gl_FragColor=texture2D(image,uv);}'));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
      const data=[];for(let y=0;y<512;y+=8)for(let x=0;x<512;x+=8)data.push(x,y,x+8,y,x,y+8,x+8,y,x+8,y+8,x,y+8);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);const attr=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
      const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.uniform1i(gl.getUniformLocation(program,'image'),0);const clock=gl.getUniformLocation(program,'clock'),mode=gl.getUniformLocation(program,'mode');let uploaded=false;
      return {draw(time,changed){if(changed||!uploaded){gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,combinedPhoto);uploaded=true;}gl.viewport(0,0,768,768);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniform1f(clock,time);gl.uniform4f(mode,rig.work,rig.scan,rig.happy,rig.gesture);gl.drawArrays(gl.TRIANGLES,0,data.length/2);return c;},dispose(){gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);}};
    }
    const photoWarp=createPhotoWarp();
    function protectiveShield(at,time,opacity){
      if(opacity<.001)return;const beat=.5+.5*Math.sin(time*3.3);const center=point(at.x+9,at.y-3);painter.save();painter.globalAlpha=opacity;
      const glow=painter.createRadialGradient(center.x,center.y,35,center.x,center.y,106);glow.addColorStop(0,`rgba(105,255,213,${.14+.08*beat})`);glow.addColorStop(1,'rgba(105,255,213,0)');painter.fillStyle=glow;painter.fillRect(center.x-108,center.y-108,216,216);painter.shadowColor='#79ffe1';painter.shadowBlur=14+8*beat;drawPiece(pieces.shield,point(365,330),center,Math.sin(time*1.6)*.018,1.13,opacity);painter.shadowBlur=0;
      painter.translate(center.x,center.y);painter.rotate(Math.sin(time*1.6)*.018);painter.scale(1.13,1.13);painter.translate(-365,-330);const shape=new Path2D('M365 262 Q390 277 415 284 L411 338 Q403 368 365 391 Q329 370 320 340 L315 287 Z');painter.clip(shape);const x=295+((time*.32)%1)*150;const shine=painter.createLinearGradient(x-23,0,x+23,0);shine.addColorStop(0,'rgba(220,255,249,0)');shine.addColorStop(.5,'rgba(220,255,249,.26)');shine.addColorStop(1,'rgba(220,255,249,0)');painter.fillStyle=shine;painter.fillRect(300,255,130,150);painter.restore();
    }
    function joint(arm,a,b){const upper=rotate(arm.e.x-arm.s.x,arm.e.y-arm.s.y,a);const elbow=point(arm.s.x+upper.x,arm.s.y+upper.y);const lower=rotate(arm.w.x-arm.e.x,arm.w.y-arm.e.y,a+b);return {elbow,wrist:point(elbow.x+lower.x,elbow.y+lower.y),a,b,total:a+b};}
    function drawPiece(img,source,destination,angle=0,scale=1,opacity=1){if(opacity<.001)return;painter.save();painter.globalAlpha=opacity;painter.translate(destination.x,destination.y);painter.rotate(angle);painter.scale(scale,scale);painter.translate(-source.x,-source.y);painter.drawImage(img,0,0);painter.restore();}
    function updateRig(pose,time){const now=performance.now(),dt=Math.max(.001,(now-lastRigTime)/1000);lastRigTime=now;if((firstRigFrame||now<holdRigUntil)&&!reduced.matches){firstRigFrame=false;rigMoving=true;return;}firstRigFrame=false;const desired={...neutral,...(target[pose]||{})};
      if(pose==='idle'&&state.motion&&!reduced.matches){const cycle=(time-poseStarted)%18;desired.curious=pulse((cycle-4)/5);desired.wink=pulse((cycle-12)/1.25);}
      const amount=reduced.matches?1:1-Math.exp(-12.5*dt);rigMoving=false;for(const key of Object.keys(rig)){const tolerance=['r','g','b'].includes(key)?.05:.001;const difference=desired[key]-rig[key];if(Math.abs(difference)>tolerance){rig[key]+=difference*amount;rigMoving=true;}else rig[key]=desired[key];}
      root.dataset.idleGesture=rig.curious>.15?'curious':rig.wink>.15?'wink':'neutral';
    }
    function lensScan(time){
      if(rig.scan<.001)return;const x=417,y=273,phase=(time*.42)%1,sy=y-33+phase*66;const p=painter;p.save();p.globalAlpha=rig.scan;p.beginPath();p.ellipse(x,y,30.5,33,-.2,0,Math.PI*2);p.clip();
      p.strokeStyle='rgba(80,214,210,.16)';p.lineWidth=.7;p.beginPath();for(let xx=x-30;xx<x+32;xx+=12){p.moveTo(xx,y-34);p.lineTo(xx,y+34);}for(let yy=y-31;yy<y+33;yy+=12){p.moveTo(x-33,yy);p.lineTo(x+33,yy);}p.stroke();
      const tail=p.createLinearGradient(0,sy-15,0,sy+5);tail.addColorStop(0,'rgba(56,229,232,0)');tail.addColorStop(.65,'rgba(43,221,224,.19)');tail.addColorStop(.86,'rgba(132,255,245,.6)');tail.addColorStop(1,'rgba(62,230,228,0)');p.fillStyle=tail;p.fillRect(x-35,sy-15,70,20);p.shadowColor='#6effef';p.shadowBlur=9;p.strokeStyle='rgba(219,255,253,.97)';p.lineWidth=2;p.beginPath();p.moveTo(x-35,sy);p.lineTo(x+35,sy);p.stroke();p.shadowBlur=0;
      p.strokeStyle='rgba(38,148,151,.65)';p.lineWidth=1;p.beginPath();p.arc(x,y,7,0,Math.PI*2);p.moveTo(x-11,y);p.lineTo(x-5,y);p.moveTo(x+5,y);p.lineTo(x+11,y);p.moveTo(x,y-11);p.lineTo(x,y-5);p.moveTo(x,y+5);p.lineTo(x,y+11);p.stroke();p.restore();
    }
    function face(time,blink){
      const color=`rgb(${Math.round(rig.r)} ${Math.round(rig.g)} ${Math.round(rig.b)})`;
      const draw=painter;
      const curiousX=rig.curious*Math.sin(time*1.05)*11,curiousY=rig.curious*Math.cos(time*.8)*3;
      const listenX=rig.listen*Math.sin(time*.95)*2.8,listenY=rig.listen*(-1.2+Math.sin(time*1.2)*.8);
      const winkAmount=state.pose==='idle'?rig.wink:rig.wink*pulse(((time-poseStarted)%4.6-.7)/1.05);
      root.dataset.wink=winkAmount.toFixed(3);
      if(rig.scan>.001){
        draw.save();draw.globalAlpha=rig.scan;draw.beginPath();draw.roundRect(161,136,210,123,41);draw.clip();
        const pass=(time*.28)%1,sy=145+pass*105;
        draw.lineWidth=.7;draw.strokeStyle='rgba(101,238,241,.11)';draw.beginPath();for(let x=173;x<373;x+=20){draw.moveTo(x,136);draw.lineTo(x,260);}for(let y=145;y<261;y+=19){draw.moveTo(158,y);draw.lineTo(374,y);}draw.stroke();
        const band=draw.createLinearGradient(0,sy-35,0,sy+9);band.addColorStop(0,'rgba(84,238,249,0)');band.addColorStop(.58,'rgba(84,238,249,.06)');band.addColorStop(.87,'rgba(99,250,247,.29)');band.addColorStop(.94,'rgba(161,255,251,.55)');band.addColorStop(1,'rgba(84,238,249,0)');draw.fillStyle=band;draw.fillRect(159,sy-35,216,44);
        draw.shadowColor='#7afff4';draw.shadowBlur=10;draw.strokeStyle='rgba(189,255,255,.95)';draw.lineWidth=2;draw.beginPath();draw.moveTo(164,sy);draw.lineTo(372,sy);draw.stroke();draw.shadowBlur=0;
        draw.strokeStyle='rgba(122,255,242,.7)';draw.lineWidth=1.7;draw.lineCap='round';draw.beginPath();for(const [x,y,sx,dy] of [[185,153,1,1],[351,153,-1,1],[185,243,1,-1],[351,243,-1,-1]]){draw.moveTo(x+12*sx,y);draw.lineTo(x,y);draw.lineTo(x,y+9*dy);}draw.stroke();
        const tx=270+Math.sin(time*.9)*26,ty=211+Math.cos(time*1.3)*8;draw.globalAlpha=rig.scan*(.35+.25*Math.sin(time*3));draw.strokeStyle='#a4fff3';draw.lineWidth=1;draw.beginPath();draw.arc(tx,ty,7,0,Math.PI*2);draw.moveTo(tx-11,ty);draw.lineTo(tx-4,ty);draw.moveTo(tx+4,ty);draw.lineTo(tx+11,ty);draw.stroke();draw.restore();
      }
      function eye(x,y,side){
        draw.save();draw.translate(x+(rig.scan*Math.sin(time*1.3))*1.8+curiousX+listenX+rig.cipher*4+rig.thinking*(8+Math.sin(time*.9)*2),y+curiousY+listenY+rig.cipher+rig.work*3-rig.thinking*7);draw.scale(1,Math.max(.035,1-Math.max(blink,side<0?winkAmount:0)*.965));draw.shadowColor=color;draw.shadowBlur=8;
        const shine=draw.createLinearGradient(-12,-24,12,24);shine.addColorStop(0,'#c8fff1');shine.addColorStop(.45,color);shine.addColorStop(1,color);draw.fillStyle=shine;draw.strokeStyle=shine;
        if(rig.happy<.999){draw.globalAlpha=1-rig.happy;const width=22+rig.alert*5,height=48-rig.scan*11-rig.alert*18-rig.listen*7-rig.cipher*9-rig.thinking*10;draw.beginPath();if(rig.alert<.001)draw.roundRect(-width/2,-height/2,width,height,width/2);else{const tilt=side<0?1:-1;draw.moveTo(-width/2+4,-height/2-tilt*rig.alert*7);draw.lineTo(width/2-3,-height/2+tilt*rig.alert*7);draw.quadraticCurveTo(width/2,-height/2+tilt*rig.alert*7,width/2,-height/2+tilt*rig.alert*7+5);draw.lineTo(width/2,height/2-7);draw.quadraticCurveTo(width/2,height/2,0,height/2);draw.quadraticCurveTo(-width/2,height/2,-width/2,height/2-7);draw.lineTo(-width/2,-height/2-tilt*rig.alert*7+5);draw.quadraticCurveTo(-width/2,-height/2-tilt*rig.alert*7,-width/2+4,-height/2-tilt*rig.alert*7);draw.closePath();}draw.fill();}
        if(rig.happy>.001){draw.globalAlpha=rig.happy;draw.lineWidth=7;draw.lineCap='round';draw.beginPath();draw.moveTo(-18,4);draw.quadraticCurveTo(0,-17-2*Math.sin(time*2.6),18,4);draw.stroke();}
        if(rig.alert>.001){draw.globalAlpha=rig.alert;draw.lineWidth=4;draw.lineCap='round';draw.beginPath();draw.moveTo(-16,side<0?-34:-22);draw.lineTo(16,side<0?-22:-34);draw.stroke();}
        draw.restore();
      }
      eye(230,193,-1);eye(317,192,1);
      if(winkAmount>.001){
        draw.save();draw.globalAlpha=winkAmount*.85;draw.strokeStyle=color;draw.lineWidth=3;draw.lineCap='round';
        draw.beginPath();draw.moveTo(305,157-winkAmount*2);draw.quadraticCurveTo(317,148-winkAmount*3,330,155-winkAmount*2);draw.stroke();
        draw.globalAlpha=winkAmount*.36;draw.fillStyle=color;
        for(const x of [220,330]){draw.beginPath();draw.ellipse(x,216,8,2.7,0,0,Math.PI*2);draw.fill();}
        draw.restore();
      }
      if(rig.curious>.001){draw.save();draw.globalAlpha=rig.curious*.8;draw.strokeStyle=color;draw.lineWidth=3;draw.lineCap='round';draw.beginPath();draw.moveTo(216+curiousX,158+curiousY);draw.quadraticCurveTo(229+curiousX,151+curiousY,242+curiousX,157+curiousY);draw.stroke();draw.restore();}
      draw.save();draw.translate(275,230);draw.shadowColor=color;draw.shadowBlur=7;draw.fillStyle=color;draw.strokeStyle=color;draw.lineWidth=4;draw.lineCap='round';
      const normal=Math.max(0,1-rig.happy-rig.talk);
      if(normal>.001){draw.globalAlpha=normal;draw.beginPath();draw.moveTo(-12-rig.wink*2,0);draw.quadraticCurveTo(0,12-11*rig.alert+rig.wink*5+winkAmount*5-rig.listen*5-rig.cipher*6-rig.work*4-rig.thinking*9,12+rig.wink*2,-rig.curious*3-winkAmount*4);draw.stroke();}
      if(rig.happy>.001){draw.save();draw.globalAlpha=rig.happy;draw.scale(1,.84+.16*Math.abs(Math.sin(time*2.8)));draw.beginPath();draw.moveTo(-17,-3);draw.quadraticCurveTo(0,3,17,-3);draw.quadraticCurveTo(15,17,0,18);draw.quadraticCurveTo(-15,17,-17,-3);draw.fill();draw.globalAlpha=rig.happy*.7;draw.fillStyle='#e4fff5';draw.beginPath();draw.ellipse(0,11,7,2.7,0,0,Math.PI*2);draw.fill();draw.restore();}
      if(rig.talk>.001){const syllable=Math.max(0,Math.min(1,.5+.34*Math.sin(time*11)+.16*Math.sin(time*18.75)));root.dataset.mouthOpen=syllable.toFixed(3);draw.globalAlpha=rig.talk;draw.beginPath();draw.ellipse(0,1,6+7*syllable,1.5+11*syllable,0,0,Math.PI*2);draw.fill();}else root.dataset.mouthOpen='0.000';
      root.dataset.speaking=String(rig.talk>.5);
      root.dataset.listening=String(rig.listen>.5);
      draw.restore();
      if(rig.listen>.001){
        draw.save();draw.beginPath();draw.roundRect(161,136,210,123,41);draw.clip();
        draw.strokeStyle=color;draw.fillStyle=color;draw.lineWidth=2.4;draw.lineCap='round';draw.shadowColor=color;draw.shadowBlur=6;
        draw.globalAlpha=rig.listen*.8;
        for(const [x,lift] of [[230,2],[317,0]]){draw.beginPath();draw.moveTo(x-12+listenX,159+listenY-lift);draw.quadraticCurveTo(x+listenX,153+listenY-lift,x+12+listenX,159+listenY-lift);draw.stroke();}
        for(let i=0;i<3;i++){
          const wave=.5+.5*Math.sin(time*3.2-i*1.1);
          draw.globalAlpha=rig.listen*(.18+.52*wave);draw.lineWidth=1.6;
          for(const side of [-1,1]){const x=side<0?198:347,angle=side<0?Math.PI:0;draw.beginPath();draw.arc(x,190,8+i*6,angle-.5,angle+.5);draw.stroke();}
        }
        const activity=.5+.5*Math.sin(time*2.2);root.dataset.listenPulse=activity.toFixed(3);
        const glow=draw.createRadialGradient(274,250,3,274,250,48);glow.addColorStop(0,'rgba(123,255,230,.16)');glow.addColorStop(1,'rgba(123,255,230,0)');draw.globalAlpha=rig.listen;draw.fillStyle=glow;draw.fillRect(225,236,98,23);
        const light=draw.createLinearGradient(0,240,0,259);light.addColorStop(0,'#d1fff4');light.addColorStop(.5,color);light.addColorStop(1,'#54bfae');draw.fillStyle=light;draw.globalAlpha=rig.listen*.95;
        for(let i=0;i<9;i++){const envelope=Math.sin(i*Math.PI/8),wave2=.5+.5*Math.sin(time*4.2+i*.9),h=3+14*envelope*(micLevel>.02?Math.min(1,.2+micLevel*(.55+.9*wave2)):wave2);draw.beginPath();draw.roundRect(237+i*8.5,250-h/2,3.5,h,1.75);draw.fill();}
        draw.fillStyle=color;draw.globalAlpha=rig.listen*(.4+.35*activity);for(const x of [222,327]){draw.beginPath();draw.arc(x,250,1.8,0,Math.PI*2);draw.fill();}
        draw.restore();
      }
      if(rig.happy>.001){draw.save();draw.globalAlpha=rig.happy;const warmth=.65+.15*Math.sin(time*2.4)+.2*Math.exp(-Math.max(0,time-pettingAt));for(const x of [210,337]){const blush=draw.createRadialGradient(x,219,1,x,219,18);blush.addColorStop(0,`rgba(255,167,199,${warmth*.72})`);blush.addColorStop(1,'rgba(255,143,186,0)');draw.fillStyle=blush;draw.fillRect(x-19,208,38,22);}draw.strokeStyle='#ffc6df';draw.globalAlpha=rig.happy*.65;draw.lineWidth=2.2;draw.lineCap='round';for(const x of [207,214,333,340]){draw.beginPath();draw.moveTo(x,217);draw.lineTo(x-3,221);draw.stroke();}draw.restore();}
      const beat=.5+.5*Math.sin(time*(3.2+rig.happy*2.2+rig.listen*1.5+rig.cipher*1.2));draw.save();const lamp=draw.createRadialGradient(296,27,2,296,27,20);lamp.addColorStop(0,`rgba(${rig.r},${rig.g},${rig.b},${.12+.22*beat})`);lamp.addColorStop(1,`rgba(${rig.r},${rig.g},${rig.b},0)`);draw.fillStyle=lamp;draw.fillRect(276,7,40,40);draw.restore();
      return winkAmount;
    }
    function gestureSymbols(time,winkAmount){
      const question=Math.max(0,Math.min(1,rig.curious));
      const closing=Math.max(0,Math.min(1,(winkAmount-.45)/.4));
      const star=closing*closing*(3-2*closing);
      root.dataset.starOpacity=star.toFixed(3);
      root.dataset.gestureSymbol=question>.15?'question':star>.15?'star':'none';
      function symbol(text,opacity,isStar){
        if(opacity<.001)return;
        painter.save();painter.globalAlpha=opacity;
        painter.translate(419,132+Math.sin(time*1.9)*5);
        painter.rotate(Math.sin(time*1.5)*(isStar?.14:.08));
        const size=isStar?.65+.45*winkAmount:1+.035*Math.sin(time*3.4);
        painter.scale(size,size);painter.textAlign='center';painter.textBaseline='middle';
        painter.font=`500 ${isStar?42:46}px system-ui,sans-serif`;
        painter.shadowColor=isStar?'#ffce6f':'#78efcf';painter.shadowBlur=isStar?12:9;
        const light=painter.createLinearGradient(0,-23,0,23);
        light.addColorStop(0,isStar?'#fff7c8':'#d1fff4');
        light.addColorStop(.5,isStar?'#ffdc84':'#8ef0d3');
        light.addColorStop(1,isStar?'#e5a750':'#4bbca7');
        painter.fillStyle=light;painter.fillText(text,0,0);
        if(isStar){
          painter.globalAlpha=opacity*.7;painter.font='500 15px system-ui,sans-serif';painter.shadowBlur=7;
          painter.fillText('✦',26+star*5,-17-star*4);
          painter.font='500 11px system-ui,sans-serif';painter.fillText('✦',-19-star*3,-26-star*3);
        }
        painter.restore();
      }
      if(rig.thinking>.001){
        painter.save();painter.globalAlpha=rig.thinking;painter.fillStyle='#9de9dc';painter.strokeStyle='#9de9dc';painter.shadowColor='#8be8d4';painter.shadowBlur=6;
        function gear(x,y,size,direction){painter.save();painter.translate(x,y);painter.rotate(time*.65*direction);painter.font=size+'px "Segoe UI Symbol",sans-serif';painter.textAlign='center';painter.textBaseline='middle';painter.globalAlpha=rig.thinking*.9;painter.fillText('⚙︎',0,0);painter.restore();}
        gear(418,108,43,1);gear(447,137,30,-1);
        for(let i=0;i<3;i++){const wave=.5+.5*Math.sin(time*3.8-i*.9);painter.globalAlpha=rig.thinking*(.35+.65*wave);painter.beginPath();painter.arc(409+i*13,165-wave*3,2.5+wave,0,Math.PI*2);painter.fill();}
        painter.globalAlpha=rig.thinking*.7;painter.lineWidth=2.5;painter.lineCap='round';painter.beginPath();painter.moveTo(217,155);painter.quadraticCurveTo(230,146,243,154);painter.stroke();painter.restore();
      }
      symbol('?',question,false);
      symbol('★',star,true);
      if(rig.happy>.001){
        const affection=1+.35*Math.exp(-Math.max(0,time-pettingAt));
        [[148,132,18],[405,139,22],[371,68,14]].forEach(([x,y,size],i)=>{
          const phase=(time*.32+i*.31)%1,opacity=Math.sin(phase*Math.PI)*rig.happy;
          painter.save();painter.globalAlpha=opacity;painter.translate(x+Math.sin(time*1.6+i)*3,y-phase*27);
          painter.scale(affection,affection);painter.font=`500 ${size}px system-ui,sans-serif`;painter.textAlign='center';
          painter.shadowColor='#ffb1d0';painter.shadowBlur=9;painter.fillStyle=i===1?'#a8f1dd':'#ffc3dc';painter.fillText('♥',0,0);painter.restore();
        });
      }
    }
    function cipherEffect(time){
      if(rig.cipher<.001){root.dataset.lockOpenness='0.000';return;}
      const elapsed=Math.max(0,time-poseStarted),arrival=Math.max(0,Math.min(1,elapsed/1.05));
      const ease=!state.motion||reduced.matches?1:arrival*arrival*(3-2*arrival);
      const opening=state.pose==='decrypt'?ease:state.pose==='encrypt'?1-ease:rig.unlock;
      const color=`rgb(${Math.round(rig.r)} ${Math.round(rig.g)} ${Math.round(rig.b)})`;
      root.dataset.lockOpenness=opening.toFixed(3);
      painter.save();painter.translate(426,306+Math.sin(time*1.8)*3);painter.globalAlpha=rig.cipher;
      const halo=painter.createRadialGradient(0,0,10,0,0,62);halo.addColorStop(0,`rgba(${rig.r},${rig.g},${rig.b},.2)`);halo.addColorStop(1,`rgba(${rig.r},${rig.g},${rig.b},0)`);painter.fillStyle=halo;painter.fillRect(-63,-63,126,126);
      const direction=1-2*rig.unlock,angle=time*.9*direction;
      painter.strokeStyle=color;painter.lineWidth=1.4;painter.lineCap='round';
      for(let i=0;i<3;i++){painter.globalAlpha=rig.cipher*(.23+i*.12);painter.beginPath();painter.arc(0,-1,44,angle+i*Math.PI*2/3,angle+i*Math.PI*2/3+1.18);painter.stroke();}
      for(let i=0;i<3;i++){
        const phase=(time*.4+i/3)%1,travel=rig.unlock>.5?phase:1-phase;
        const x=12+travel*42,y=-21-travel*35;
        painter.globalAlpha=rig.cipher*Math.sin(phase*Math.PI)*.75;painter.strokeStyle=color;painter.lineWidth=1.3;
        painter.beginPath();painter.roundRect(x-5,y-7,10,13,2);painter.stroke();
        painter.beginPath();painter.moveTo(x-2,y-2);painter.lineTo(x+2,y-2);painter.moveTo(x-2,y+1);painter.lineTo(x+1,y+1);painter.stroke();
      }
      painter.globalAlpha=rig.cipher;painter.shadowColor=color;painter.shadowBlur=10;
      painter.save();painter.translate(-12,-4);painter.rotate(-opening*.75);painter.strokeStyle=rig.unlock>.5?'#c6edff':'#c9ffed';painter.lineWidth=5;
      painter.beginPath();painter.moveTo(0,0);painter.lineTo(0,-12);painter.bezierCurveTo(0,-30,24,-30,24,-12);painter.lineTo(24,0);painter.stroke();painter.restore();
      const shell=painter.createLinearGradient(-18,-5,19,31);shell.addColorStop(0,rig.unlock>.5?'#b4e8ff':'#b6f8dc');shell.addColorStop(.4,rig.unlock>.5?'#5aabc4':'#64c6a7');shell.addColorStop(1,rig.unlock>.5?'#254755':'#1c4d42');
      painter.fillStyle=shell;painter.strokeStyle=rig.unlock>.5?'#b6eaff':'#a9f5d9';painter.lineWidth=1.5;
      painter.beginPath();painter.roundRect(-21,-4,42,34,8);painter.fill();painter.stroke();
      painter.shadowBlur=0;painter.strokeStyle='rgba(235,255,250,.65)';painter.lineWidth=1;painter.beginPath();painter.moveTo(-13,2);painter.lineTo(13,2);painter.stroke();
      painter.fillStyle=rig.unlock>.5?'#143743':'#123b30';painter.beginPath();painter.arc(0,9,4,0,Math.PI*2);painter.fill();painter.beginPath();painter.roundRect(-2,11,4,9,1.5);painter.fill();
      painter.restore();
    }
    function common(time,blink,lookAt){
      updateRig(state.pose,time);
      const r=joint(right,rig.rs,rig.re);
      const changed=blendPhoto(),photo=photoWarp?photoWarp.draw(time,changed):combinedPhoto;
      const scale=frame.width/576;painter.save();painter.setTransform(scale,0,0,scale,32*scale,32*scale);
      painter.drawImage(photo,0,0,512,512);
      lensScan(time);
      protectiveShield(r.wrist,time,rig.shield);
      cipherEffect(time);
      const winkAmount=face(time,blink);gestureSymbols(time,winkAmount);painter.restore();
      root.dataset.sharedBody='reposo';root.dataset.animation=rig.work>.999?'integrated-work-typing':'integrated-photo-warp';root.dataset.workTemplate=rig.work>.999?'standing-unified':'none';
    }
    function sleepingSmile(time){
      const opening=Math.pow(.5+.5*Math.sin(time*1.4),1.35),depth=2.6+12*opening;
      const s=allocated/576;painter.save();painter.setTransform(s,0,0,s,32*s,32*s);painter.translate(267,279-Math.sin(time)*.6);painter.scale(1.28,1);painter.shadowColor='rgba(112,255,221,.55)';painter.shadowBlur=4;
      const mint=painter.createLinearGradient(0,-2,0,depth);mint.addColorStop(0,'#baffec');mint.addColorStop(.45,'#8bf4d4');mint.addColorStop(1,'#47b6a2');painter.fillStyle=mint;
      painter.beginPath();painter.moveTo(-9,-1);painter.quadraticCurveTo(0,2.8,9,-1);painter.quadraticCurveTo(8,depth,0,depth+.5);painter.quadraticCurveTo(-8,depth,-9,-1);painter.fill();painter.restore();root.dataset.sleepMouth=opening.toFixed(3);
    }
    function resize(){const size=Math.round(hit.clientWidth*Math.min(window.devicePixelRatio||1,2));if(size&&allocated!==size){allocated=size;canvas.width=canvas.height=frame.width=frame.height=previous.width=previous.height=size;hasSnapshot=false;}}
    return {
      retarget(){firstRigFrame=true;lastRigTime=performance.now();holdRigUntil=lastRigTime+40;},
      capture(){resize();previousPainter.setTransform(1,0,0,1,0,0);previousPainter.clearRect(0,0,allocated,allocated);previousPainter.drawImage(canvas,0,0);hasSnapshot=true;},
      draw(pose,time,blink,lookAt,blend=1){
        resize();painter.setTransform(1,0,0,1,0,0);painter.clearRect(0,0,allocated,allocated);
        if(pose.index!==4)common(time,blink,lookAt);
        else {rigMoving=false;lastRigTime=performance.now();root.dataset.sharedBody='sleep';if(legacy){legacy.draw(pose,time,blink,lookAt,1);painter.drawImage(legacyCanvas,0,0,allocated,allocated);}else{const s=allocated/576;painter.setTransform(s,0,0,s,32*s,32*s);if(pose.index===4)tile(painter,atlas,1,1);else tile(painter,extraAtlas,1,0,2,1);painter.setTransform(1,0,0,1,0,0);}}
        if(pose.index===4)sleepingSmile(time);
        output.setTransform(1,0,0,1,0,0);output.clearRect(0,0,allocated,allocated);
        if(hasSnapshot&&blend<1){output.globalAlpha=1-blend;output.drawImage(previous,0,0);output.globalCompositeOperation='lighter';output.globalAlpha=blend;output.drawImage(frame,0,0);output.globalCompositeOperation='source-over';output.globalAlpha=1;}else output.drawImage(frame,0,0);
      },
      dispose(){legacy?.dispose();photoWarp?.dispose();}
    };
  }
  function makeLegacyRenderer(){
    const canvas=legacyCanvas;
    const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true,powerPreference:'low-power'});
    if(!gl)return null;
    function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
    function link(v,f){const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,v));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,f));gl.bindAttribLocation(p,0,'aPosition');gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;}
    const program=link(vertex,fragment);gl.useProgram(program);
    const composite=link(`
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv;
      void main(){vUv=(aPosition+1.0)*.5;gl_Position=vec4(aPosition,0.0,1.0);}
    `,`
      precision highp float;
      uniform sampler2D uScene;
      uniform sampler2D uPrevious;
      uniform float uBlend;
      varying vec2 vUv;
      void main(){gl_FragColor=mix(texture2D(uPrevious,vUv),texture2D(uScene,vUv),uBlend);}
    `);
    const n=128,points=[],indices=[];
    for(let y=0;y<=n;y++)for(let x=0;x<=n;x++)points.push(x/n*512,y/n*512);
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){const a=y*(n+1)+x,b=a+1,c=a+n+1,d=c+1;indices.push(a,b,c,b,d,c);}
    const vertices=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vertices);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    const elements=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,elements);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
    const uniforms={};['uTime','uBlink','uPose','uEyeL','uEyeR','uLook','uTile','uAntenna','uChange'].forEach(name=>uniforms[name]=gl.getUniformLocation(program,name));
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    function texture(img,unit,name){const tex=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);gl.uniform1i(gl.getUniformLocation(program,name),unit);return tex;}
    const textures=[texture(atlas,0,'uAtlas'),texture(kawaii,1,'uHappy'),texture(actionAtlas,2,'uActions'),texture(extraAtlas,5,'uExtras')];
    const quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    function blankTexture(unit){const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);return t;}
    const scene=blankTexture(3),previous=blankTexture(4),fbo=gl.createFramebuffer();
    let allocated=0,hasSnapshot=false;
    gl.useProgram(composite);gl.uniform1i(gl.getUniformLocation(composite,'uScene'),3);gl.uniform1i(gl.getUniformLocation(composite,'uPrevious'),4);
    const blendUniform=gl.getUniformLocation(composite,'uBlend');
    gl.disable(gl.DEPTH_TEST);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,0);
    function sizeBuffers(){
      const size=Math.round(hit.clientWidth*Math.min(window.devicePixelRatio||1,2));
      if(!size)return;
      if(allocated!==size){
        canvas.width=size;canvas.height=size;allocated=size;hasSnapshot=false;
        for(const [t,unit] of [[scene,3],[previous,4]]){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,null);}
        gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,scene,0);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('No se pudo preparar la transición.');
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      }
      gl.viewport(0,0,canvas.width,canvas.height);
    }
    return {
      capture(){
        if(!allocated)return;
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,previous);gl.copyTexImage2D(gl.TEXTURE_2D,0,gl.RGBA,0,0,canvas.width,canvas.height,0);hasSnapshot=true;
      },
      draw(pose,time,blink,lookAt,blend=1){
        sizeBuffers();
        gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.BLEND);gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER,vertices);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,elements);
        gl.uniform1f(uniforms.uTime,time);gl.uniform1f(uniforms.uBlink,blink);gl.uniform1i(uniforms.uPose,pose.index);gl.uniform2fv(uniforms.uEyeL,pose.left);gl.uniform2fv(uniforms.uEyeR,pose.right);gl.uniform2fv(uniforms.uLook,lookAt);gl.uniform2fv(uniforms.uTile,pose.tile);gl.uniform2fv(uniforms.uAntenna,pose.antenna);gl.uniform1f(uniforms.uChange,blend);gl.drawElements(gl.TRIANGLES,indices.length,gl.UNSIGNED_SHORT,0);
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.clear(gl.COLOR_BUFFER_BIT);gl.disable(gl.BLEND);gl.useProgram(composite);
        gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.uniform1f(blendUniform,hasSnapshot?blend:1);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      },
      dispose(){[...textures,scene,previous].forEach(t=>gl.deleteTexture(t));[vertices,elements,quad].forEach(b=>gl.deleteBuffer(b));gl.deleteFramebuffer(fbo);gl.deleteProgram(program);gl.deleteProgram(composite);}
    };
  }
  Promise.all([atlas.decode(),kawaii.decode(),actionAtlas.decode(),extraAtlas.decode(),bodyAtlas.decode(),analysisAtlas.decode(),workAtlas.decode()]).then(()=>{
    renderer=makeSharedRenderer(makeLegacyRenderer());
    if(!renderer){
      const replacement=document.createElement('canvas');replacement.className=canvas.className;replacement.width=512;replacement.height=512;replacement.setAttribute('role','img');replacement.setAttribute('aria-label','LyFan, vista estática');canvas.replaceWith(replacement);const context=replacement.getContext('2d');
      renderer={draw(pose){context.clearRect(0,0,512,512);if(pose.index===5)context.drawImage(kawaii,16,0,480,480);else if(pose.index===6||pose.index===7)context.drawImage(extraAtlas,(pose.index-6)*extraAtlas.naturalWidth/2,0,extraAtlas.naturalWidth/2,extraAtlas.naturalHeight,0,0,512,512);else if(pose.index===1||pose.index===2)context.drawImage(actionAtlas,(pose.index-1)*actionAtlas.naturalWidth/2,0,actionAtlas.naturalWidth/2,actionAtlas.naturalHeight,0,0,512,512);else context.drawImage(atlas,pose.tile[0]*512,pose.tile[1]*512,512,512,0,0,512,512);}};
      state.motion=false;root.dataset.renderer='static';root.querySelector('.pet-motion').hidden=true;
    }else root.dataset.renderer='shared-rig';
    ready=true;render();
    document.dispatchEvent(new CustomEvent('lyfan:listo'));
  }).catch(error=>{status.textContent='No se pudo cargar la animación.';root.dataset.renderer='error';console.error(error);});
  new ResizeObserver(()=>start()).observe(hit);
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)start();else if(raf){cancelAnimationFrame(raf);raf=0;}}).observe(root);
  // --- API pública de LyFan Guard (agregada a la copia del diseño original) ---
  window.LyFan={
    setPose:p=>choose(p),
    say:t=>{phrase.textContent=t;},
    lookAt:(x,y)=>{if(state.motion&&state.pose!=='sleep'&&!reduced.matches)look=[Math.max(-1,Math.min(1,x)),Math.max(-1,Math.min(1,y))];},
    nivelMic:v=>{micLevel=Math.max(0,Math.min(1,+v||0));},   // las barras de "Escuchando" siguen el volumen real del micrófono
    get pose(){return state.pose;},
    poses:Object.keys(poses),
    datos:poses                                                // metadatos de cada pose (frases, colores…)
  };
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();ready=false;if(raf)cancelAnimationFrame(raf);raf=0;status.textContent='Animación en pausa. Recarga para continuar.';});
})();

