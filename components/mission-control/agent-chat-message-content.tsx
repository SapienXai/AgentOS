"use client";

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

export function AgentChatMessageContent({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("agent-chat-markdown min-w-0 max-w-full text-[14px] leading-7 text-foreground", className)}>
      <Markdown components={messageComponents} remarkPlugins={[remarkGfm]} skipHtml>
        {text}
      </Markdown>
    </div>
  );
}
