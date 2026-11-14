"use client";
/**
 * The living background: a WebGL field of drifting jade and gold light, slowly
 * flowing contour lines and fine gold dust, in depth layers that shift with the
 * pointer. Purely decorative (no data, no fake signals). Renders at reduced
 * resolution, pauses when the tab is hidden, drops to ~30 fps in "lite" mode and
 * draws a single still frame for reduced-motion users.
 */
import { useEffect, useRef } from "react";
import { useFx, usePageVisible } from "@/lib/fx";

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

const FRAG = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_night;
uniform float u_rich;

float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<4;i++){v+=a*noise(p);p=m*p;a*=.5;}return v;}

float lineW(float v,float w){
#ifdef GL_OES_standard_derivatives
  float d=fwidth(v)*w;
#else
  float d=.02*w;
#endif
  float f=abs(fract(v)-.5);
  return 1.-smoothstep(0.,d,f-.5+d*1.2);
}

float dust(vec2 p,float t,float scale,float speed){
  p*=scale; p.y-=t*speed;
  vec2 cell=floor(p); vec2 f=fract(p)-.5;
  float h=hash(cell);
  if(h<.72) return 0.;
  vec2 o=vec2(hash(cell+3.1),hash(cell+7.7))-.5;
  o*=.6; o+=.12*vec2(sin(t*.7+h*40.),cos(t*.5+h*20.));
  float d=length(f-o);
  float tw=.55+.45*sin(t*(1.+h*2.)+h*60.);
  return smoothstep(.06,0.,d)*tw;
}

void main(){
  vec2 uv=gl_FragCoord.xy/u_res;
  float asp=u_res.x/u_res.y;
  vec2 p=vec2((uv.x-.5)*asp,uv.y-.5);
  float t=u_time;

  // Depth layers: far light, mid contours, near dust, each shifted by the pointer.
  vec2 pFar=p+u_mouse*.012;
  vec2 pMid=p+u_mouse*.028;
  vec2 pNear=p+u_mouse*.05;

  vec3 dayBase=vec3(.965,.973,.961);
  vec3 nightBase=vec3(.035,.095,.086);
  vec3 base=mix(dayBase,nightBase,u_night);
  vec3 jade=mix(vec3(0.,.42,.37),vec3(.10,.55,.48),u_night);
  vec3 gold=vec3(.93,.80,.48);

  // Drifting pools of jade and gold light.
  vec2 drift=vec2(t*.018,-t*.012);
  float j=fbm(pFar*1.25+drift);
  float g=fbm(pFar*1.05-drift*1.3+vec2(4.2,1.7));
  float jadePool=smoothstep(.45,.85,j);
  float goldPool=smoothstep(.55,.9,g);
  vec3 col=base;
  col=mix(col,mix(col,jade,.55),jadePool*mix(.24,.42,u_night));
  col+=gold*goldPool*mix(.15,.16,u_night)*(1.-u_night*.3);

  // Flowing contour lines (an isobar-like field that slowly streams).
  float field=fbm(pMid*.9+vec2(t*.01,t*.006))+.35*fbm(pMid*2.1-vec2(t*.02,0.));
  float c=lineW(field*11.-t*.06,1.);
  float cMajor=lineW(field*2.75-t*.015,1.4);
  vec3 lineCol=mix(jade,gold,.25+.45*u_night);
  col=mix(col,lineCol,c*mix(.11,.13,u_night)*u_rich);
  col=mix(col,gold,cMajor*mix(.20,.22,u_night)*u_rich);

  // A slow band of light that sweeps across now and then.
  float sweepPos=fract(t/19.)*3.2-1.1;
  float band=exp(-pow((uv.x+uv.y*.55-sweepPos)*5.,2.));
  col+=vec3(1.,.95,.82)*band*mix(.08,.07,u_night)*u_rich;

  // Gold dust in two depths.
  float d1=dust(pNear+vec2(13.,0.),t,26.,.018);
  float d2=dust(pMid+vec2(0.,7.),t,48.,.010);
  col=mix(col,gold*mix(1.,1.15,u_night),clamp(d1*.55+d2*.32,0.,1.)*u_rich);

  // Soft vignette toward the edges.
  float v=smoothstep(1.25,.25,length(p*vec2(.85,1.1)));
  col=mix(col*mix(.97,.82,u_night),col,v);
  gl_FragColor=vec4(col,1.);
}`;

export function LivingSky() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { motion, theme } = useFx();
  const visible = usePageVisible();
  const nightTarget = useRef(theme === "night" ? 1 : 0);
  nightTarget.current = theme === "night" ? 1 : 0;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const gl = element.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) return;
    gl.getExtension("OES_standard_derivatives");
    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = {
      res: gl.getUniformLocation(program, "u_res"),
      time: gl.getUniformLocation(program, "u_time"),
      mouse: gl.getUniformLocation(program, "u_mouse"),
      night: gl.getUniformLocation(program, "u_night"),
      rich: gl.getUniformLocation(program, "u_rich"),
    };

    const scale = motion === "lite" ? 0.35 : 0.55;
    const resize = () => {
      const w = Math.max(1, Math.round(window.innerWidth * scale));
      const h = Math.max(1, Math.round(window.innerHeight * scale));
      element.width = w;
      element.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(u.res, w, h);
    };
    resize();
    window.addEventListener("resize", resize);

    const pointer = { x: 0, y: 0 };
    const smooth = { x: 0, y: 0 };
    const onPointer = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = -(event.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    let night = nightTarget.current;
    // Start part-way into the cycle so the first frame is already interesting.
    const start = performance.now() - 40_000;
    const draw = (now: number) => {
      smooth.x += (pointer.x - smooth.x) * 0.04;
      smooth.y += (pointer.y - smooth.y) * 0.04;
      night += (nightTarget.current - night) * 0.05;
      gl.uniform1f(u.time, (now - start) / 1000);
      gl.uniform2f(u.mouse, smooth.x, smooth.y);
      gl.uniform1f(u.night, night);
      gl.uniform1f(u.rich, motion === "lite" ? 0.7 : 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    let raf = 0;
    let skip = false;
    if (motion === "calm" || !visible) {
      night = nightTarget.current;
      draw(start + 40_000);
      // Redraw once when the theme changes while still.
      const timer = window.setInterval(() => {
        if (Math.abs(night - nightTarget.current) > 0.01) {
          night = nightTarget.current;
          draw(start + 40_000);
        }
      }, 300);
      return () => {
        window.clearInterval(timer);
        window.removeEventListener("resize", resize);
        window.removeEventListener("pointermove", onPointer);
      };
    }
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (motion === "lite") {
        skip = !skip;
        if (skip) return;
      }
      draw(now);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
    };
  }, [motion, visible]);

  return <canvas ref={canvas} className="living-sky" aria-hidden="true" />;
}
