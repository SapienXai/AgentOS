"use client";

import { memo, useEffect, useEffectEvent, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

const messageComponents: Components = {
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  img: ({ alt }) => <span className="text-muted-foreground">{alt ? `Image: ${alt}` : "Image omitted"}</span>
};

const messagePlugins = [remarkGfm];

function MessageMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("agent-chat-markdown min-w-0 max-w-full text-[14px] leading-7 text-foreground", className)}>
      <Markdown components={messageComponents} remarkPlugins={messagePlugins} skipHtml>
        {text}
      </Markdown>
    </div>
  );
}

type ReplyReveal = {
  id: string;
  isStreaming: boolean;
  onChange: (id: string, revealing: boolean) => void;
};

const revealIntervalMs = 36;
const maxRevealSteps = 24;

function RevealingReply({ text, className, reveal }: { text: string; className?: string; reveal: ReplyReveal }) {
  const { id, isStreaming, onChange } = reveal;
  const reducedMotion = useReducedMotion();
  const [visibleLength, setVisibleLength] = useState(() => isStreaming ? 0 : text.length);
  const wordEnds = useMemo(() => Array.from(text.matchAll(/\S+\s*/g), (word) => word.index + word[0].length), [text]);
  const isRevealing = !reducedMotion && visibleLength < text.length;
  const isPresenting = isStreaming || isRevealing;
  const advance = useEffectEvent(() => {
    setVisibleLength((current) => {
      const nextWord = wordEnds.findIndex((end) => end > current);
      if (nextWord === -1) return text.length;

      const wordsPerStep = Math.max(1, Math.ceil(wordEnds.length / maxRevealSteps));
      return wordEnds[Math.min(nextWord + wordsPerStep, wordEnds.length) - 1];
    });
  });

  // Keep the local reply mounted until both the native turn and its reveal have finished.
  useEffect(() => {
    if (!isPresenting) return;
    onChange(id, true);
    return () => onChange(id, false);
  }, [id, isPresenting, onChange]);

  // Keep the timer running across incoming chunks so a busy stream cannot postpone every step.
  useEffect(() => {
    if (!isRevealing) return;
    const timer = window.setInterval(advance, revealIntervalMs);
    return () => window.clearInterval(timer);
  }, [isRevealing]);

  const visibleText = isRevealing ? text.slice(0, visibleLength) : text;
  return visibleText ? <MessageMarkdown text={visibleText} className={className} /> : null;
}

export const AgentChatMessageContent = memo(function AgentChatMessageContent({
  text,
  className,
  reveal
}: {
  text: string;
  className?: string;
  reveal?: ReplyReveal;
}) {
  return reveal ? <RevealingReply text={text} className={className} reveal={reveal} /> : <MessageMarkdown text={text} className={className} />;
});
