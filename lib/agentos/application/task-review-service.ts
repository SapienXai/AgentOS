import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TaskReviewResolution, TaskReviewStatus } from "@/lib/agentos/workforce/task-review";

export type StoredTaskReview = TaskReviewResolution & { actorId: string };

export async function readTaskReview(actorId: string, taskKey: string): Promise<TaskReviewResolution | null> {
  const record = await readStoredReview(actorId, taskKey);
  return record ? omitActor(record) : null;
}

export async function writeTaskReview(input: {
  actorId: string;
  taskId: string;
  taskKey: string;
  status: TaskReviewStatus;
  action: string;
  reviewedAt?: string;
}): Promise<TaskReviewResolution> {
  const resolution: StoredTaskReview = {
    actorId: input.actorId,
    taskId: input.taskId,
    taskKey: input.taskKey,
    status: input.status,
    action: input.action.trim().slice(0, 512),
    reviewedAt: input.reviewedAt ?? new Date().toISOString()
  };
  const filePath = reviewRecordPath(input.actorId, input.taskKey);
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(resolution, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
  return omitActor(resolution);
}

export async function readTaskReviews(actorId: string, taskKeys: string[]) {
  const uniqueKeys = [...new Set(taskKeys.map((key) => key.trim()).filter(Boolean))];
  const records = await Promise.all(uniqueKeys.map(async (key) => [key, await readTaskReview(actorId, key)] as const));
  const reviews: Record<string, TaskReviewResolution> = {};
  for (const [key, review] of records) {
    if (review) reviews[key] = review;
  }
  return reviews;
}

async function readStoredReview(actorId: string, taskKey: string): Promise<StoredTaskReview | null> {
  try {
    const parsed = JSON.parse(await readFile(reviewRecordPath(actorId, taskKey), "utf8")) as Partial<StoredTaskReview>;
    if (
      parsed.actorId !== actorId || parsed.taskKey !== taskKey ||
      typeof parsed.taskId !== "string" || typeof parsed.action !== "string" ||
      typeof parsed.reviewedAt !== "string" || !isTaskReviewStatus(parsed.status)
    ) return null;
    return parsed as StoredTaskReview;
  } catch {
    return null;
  }
}

function reviewRecordPath(actorId: string, taskKey: string) {
  const id = createHash("sha256").update(`${actorId}\0${taskKey}`).digest("hex");
  return path.join(missionControlRootPath(), "reviews", `${id}.json`);
}

function missionControlRootPath() {
  const configuredRoot = process.env.AGENTOS_MISSION_CONTROL_ROOT?.trim();
  return path.resolve(configuredRoot || path.join(process.cwd(), ".mission-control"));
}

function omitActor(record: StoredTaskReview): TaskReviewResolution {
  return {
    taskId: record.taskId,
    taskKey: record.taskKey,
    status: record.status,
    action: record.action,
    reviewedAt: record.reviewedAt
  };
}

function isTaskReviewStatus(value: unknown): value is TaskReviewStatus {
  return value === "accepted" || value === "continued" || value === "retried" || value === "dismissed";
}
