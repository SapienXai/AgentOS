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
      <motion.div
        className="absolute h-[clamp(54px,6vw,86px)] w-[clamp(54px,6vw,86px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_36%_32%,#fffde8_0%,#ffe58a_35%,#ffad4e_72%)] shadow-[0_0_35px_12px_rgba(255,221,128,.48),0_0_120px_55px_rgba(255,167,80,.22)] transition-[left,top,opacity] duration-[4000ms] ease-linear motion-reduce:transition-none"
        style={{ left: `${sky.sunX}%`, top: `${sky.sunY}%`, opacity: sky.sunOpacity }}
        animate={reduceMotion ? undefined : { scale: [1, 1.035, 1] }}
        transition={{ duration: 7, ease: "easeInOut", repeat: Infinity }}
      />
      <div
        className="absolute h-[clamp(36px,4vw,58px)] w-[clamp(36px,4vw,58px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_38%_32%,#ffffff_0%,#dce7ff_55%,#9eadd7_100%)] shadow-[0_0_24px_6px_rgba(187,207,255,.28),0_0_80px_25px_rgba(113,138,207,.14)] transition-[left,top,opacity] duration-[4000ms] ease-linear motion-reduce:transition-none after:absolute after:-right-[18%] after:-top-[8%] after:h-[92%] after:w-[92%] after:rounded-full after:bg-[#101b38] after:content-['']"
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
