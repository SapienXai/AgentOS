export const directChatAttachmentTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"] as const;
export const directChatAttachmentCount = 3;
export const directChatAttachmentBytes = 2 * 1024 * 1024;

export type DirectChatAttachment = {
  mimeType: typeof directChatAttachmentTypes[number];
  fileName: string;
  origin: "file";
  content: string;
};
