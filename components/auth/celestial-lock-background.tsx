"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { getCelestialSky, getCelestialSkyAtMinute } from "@/lib/agentos/celestial-sky";

const STAR_FIELD = [
  "radial-gradient(circle at 8% 18%, rgba(255,255,255,.95) 0 1px, transparent 1.6px)",
  "radial-gradient(circle at 18% 42%, rgba(214,228,255,.8) 0 1px, transparent 1.5px)",
  "radial-gradient(circle at 29% 11%, rgba(255,255,255,.9) 0 1.2px, transparent 1.8px)",
  "radial-gradient(circle at 43% 31%, rgba(226,235,255,.75) 0 .8px, transparent 1.4px)",
  "radial-gradient(circle at 55% 9%, rgba(255,255,255,.88) 0 1px, transparent 1.6px)",
  "radial-gradient(circle at 67% 26%, rgba(210,224,255,.78) 0 1px, transparent 1.5px)",
  "radial-gradient(circle at 78% 13%, rgba(255,255,255,.92) 0 1.2px, transparent 1.8px)",
  "radial-gradient(circle at 91% 37%, rgba(222,233,255,.8) 0 .9px, transparent 1.5px)"
].join(",");

export function CelestialLockBackground() {
  const reduceMotion = useReducedMotion();
  const [sky, setSky] = useState(() => getCelestialSkyAtMinute(750));

  useEffect(() => {
    const update = () => setSky(getCelestialSky(new Date()));
    update();
    const timer = window.setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden" data-sky-phase={sky.label}>
      <div
        className="absolute inset-0 transition-[background] duration-[4000ms] ease-linear motion-reduce:transition-none"
        style={{ background: `linear-gradient(180deg, ${sky.top} 0%, ${sky.middle} 46%, ${sky.bottom} 76%, ${sky.horizon} 100%)` }}
      />

      <motion.div
        className="absolute -inset-x-[20%] -top-[18%] h-[62%] rotate-[-7deg] rounded-[50%] blur-[80px]"
        animate={reduceMotion ? undefined : { x: ["-4%", "5%", "-4%"], scaleY: [0.92, 1.08, 0.92] }}
        transition={{ duration: 38, ease: "easeInOut", repeat: Infinity }}
        style={{ background: `linear-gradient(105deg, transparent 20%, ${sky.accent} 51%, transparent 78%)`, opacity: sky.auroraOpacity }}
      />
      <motion.div
        className="absolute -right-[18%] top-[5%] h-[48%] w-[70%] rounded-full blur-[110px]"
        animate={reduceMotion ? undefined : { x: ["3%", "-5%", "3%"], y: ["-2%", "4%", "-2%"] }}
        transition={{ duration: 46, ease: "easeInOut", repeat: Infinity }}
        style={{ background: `radial-gradient(circle, ${sky.accent} 0%, transparent 69%)`, opacity: sky.auroraOpacity * 0.7 }}
      />

      <div className="absolute inset-0 transition-opacity duration-[4000ms] motion-reduce:transition-none" style={{ backgroundImage: STAR_FIELD, opacity: sky.starOpacity }} />

      <div
        className="absolute inset-0 mix-blend-screen transition-[background,opacity] duration-[4000ms] ease-linear motion-reduce:transition-none"
        style={{
          background: `radial-gradient(circle at ${sky.sunX}% ${sky.sunY}%, rgba(255,247,207,.34) 0%, rgba(255,201,112,.16) 10%, rgba(255,148,76,.07) 25%, transparent 48%)`,
          opacity: sky.sunOpacity
        }}
      />
      <div
        className="absolute transition-[left,top,opacity] duration-[4000ms] ease-linear motion-reduce:transition-none"
        style={{ left: `${sky.sunX}%`, top: `${sky.sunY}%`, opacity: sky.sunOpacity }}
      >
        <motion.div
          className="absolute h-[clamp(270px,31vw,470px)] w-[clamp(270px,31vw,470px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,252,226,.38)_0%,rgba(255,221,150,.24)_13%,rgba(255,172,91,.12)_34%,rgba(255,128,70,.045)_54%,transparent_72%)] blur-[12px] mix-blend-screen"
          animate={reduceMotion ? undefined : { opacity: [0.76, 1, 0.82, 0.76], scale: [0.97, 1.04, 1, 0.97] }}
          transition={{ duration: 11, ease: "easeInOut", repeat: Infinity }}
        />
        <motion.div
          className="absolute h-[clamp(130px,15vw,230px)] w-[clamp(130px,15vw,230px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,236,.62)_0%,rgba(255,215,130,.31)_27%,rgba(255,157,82,.08)_57%,transparent_72%)] blur-[5px] mix-blend-screen"
          animate={reduceMotion ? undefined : { opacity: [0.84, 1, 0.9, 0.84], scale: [1, 1.055, 1.02, 1] }}
          transition={{ duration: 7.5, ease: "easeInOut", repeat: Infinity }}
        />
      </div>
      <motion.div
        className="absolute h-[clamp(54px,6vw,86px)] w-[clamp(54px,6vw,86px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_34%_28%,#fffff4_0%,#fff1ad_22%,#ffc467_58%,#f58b4a_100%)] shadow-[0_0_24px_8px_rgba(255,248,199,.68),0_0_68px_28px_rgba(255,200,112,.38),0_0_150px_72px_rgba(255,141,76,.2)] transition-[left,top,opacity] duration-[4000ms] ease-linear motion-reduce:transition-none"
        style={{ left: `${sky.sunX}%`, top: `${sky.sunY}%`, opacity: sky.sunOpacity }}
        animate={reduceMotion ? undefined : { filter: ["brightness(1)", "brightness(1.09)", "brightness(1.025)", "brightness(1)"], scale: [1, 1.045, 1.015, 1] }}
        transition={{ duration: 8.5, ease: "easeInOut", repeat: Infinity }}
      />

      <div
        className="absolute inset-0 mix-blend-screen transition-[background,opacity] duration-[4000ms] ease-linear motion-reduce:transition-none"
        style={{
          background: `radial-gradient(circle at ${sky.moonX}% ${sky.moonY}%, rgba(220,232,255,.22) 0%, rgba(151,178,236,.09) 14%, rgba(105,135,210,.035) 32%, transparent 47%)`,
          opacity: sky.moonOpacity
        }}
      />
      <div
        className="absolute transition-[left,top,opacity] duration-[4000ms] ease-linear motion-reduce:transition-none"
        style={{ left: `${sky.moonX}%`, top: `${sky.moonY}%`, opacity: sky.moonOpacity }}
      >
        <motion.div
          className="absolute h-[clamp(190px,23vw,350px)] w-[clamp(190px,23vw,350px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(233,241,255,.31)_0%,rgba(181,203,250,.17)_22%,rgba(116,145,216,.065)_46%,transparent_70%)] blur-[10px] mix-blend-screen"
          animate={reduceMotion ? undefined : { opacity: [0.72, 0.94, 0.8, 0.72], scale: [0.98, 1.035, 1, 0.98] }}
          transition={{ duration: 14, ease: "easeInOut", repeat: Infinity }}
        />
      </div>
      <div
        className="absolute h-[clamp(36px,4vw,58px)] w-[clamp(36px,4vw,58px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_34%_28%,#ffffff_0%,#edf3ff_38%,#b8c8eb_72%,#8397ca_100%)] shadow-[0_0_18px_6px_rgba(229,238,255,.56),0_0_55px_22px_rgba(157,184,241,.27),0_0_115px_48px_rgba(101,132,207,.12)] transition-[left,top,opacity] duration-[4000ms] ease-linear motion-reduce:transition-none after:absolute after:-right-[18%] after:-top-[8%] after:h-[92%] after:w-[92%] after:rounded-full after:bg-[#101b38] after:shadow-[-7px_5px_13px_rgba(234,241,255,.12)] after:content-['']"
        style={{ left: `${sky.moonX}%`, top: `${sky.moonY}%`, opacity: sky.moonOpacity }}
      />

      <motion.div
        className="absolute bottom-[17%] left-[-18%] h-[13%] w-[84%] rounded-[50%] bg-white/15 blur-[34px]"
        animate={reduceMotion ? undefined : { x: ["-3%", "20%", "-3%"] }}
        transition={{ duration: 64, ease: "easeInOut", repeat: Infinity }}
      />
      <motion.div
        className="absolute bottom-[7%] right-[-20%] h-[16%] w-[82%] rounded-[50%] bg-white/10 blur-[42px]"
        animate={reduceMotion ? undefined : { x: ["7%", "-18%", "7%"] }}
        transition={{ duration: 78, ease: "easeInOut", repeat: Infinity }}
      />
      <div className="absolute inset-x-0 bottom-0 h-[32%] bg-[linear-gradient(to_top,rgba(3,7,18,.46),transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_28%,rgba(2,6,18,.18)_72%,rgba(2,6,18,.42)_100%)]" />
      <div className="absolute inset-0 opacity-[0.055] [background-image:radial-gradient(rgba(255,255,255,.9)_0.55px,transparent_0.7px)] [background-size:4px_4px] [mask-image:linear-gradient(to_bottom,black,transparent_90%)]" />
    </div>
  );
}
