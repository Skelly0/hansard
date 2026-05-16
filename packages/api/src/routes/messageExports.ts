import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireStaff } from '../middleware/requireStaff.js';
import {
  exportDiscordMessages,
  formatMessageExportMarkdown,
  InvalidMessageExportChannelsError,
  parseMessageExportChannelIds,
} from '../services/messageExportService.js';

const MAX_EXPORT_HOURS = 24;
const DEFAULT_EXPORT_HOURS = 24;
const HARD_MAX_MESSAGES = 5000;
const DEFAULT_MAX_MESSAGES = 1000;

function parseInteger(
  value: string | undefined,
  defaultValue: number,
  min: number,
): number | null {
  if (value === undefined || value.trim() === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) return null;
  return parsed;
}

export default async function messageExportRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Querystring: {
      format?: string;
      hours?: string;
      channelIds?: string;
      maxMessages?: string;
    };
  }>(
    '/api/messages/export',
    {
      preHandler: [requireAuth, requireStaff],
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const token = process.env.DISCORD_BOT_TOKEN?.trim();
      const allowedChannelIds = parseMessageExportChannelIds(process.env.MESSAGE_EXPORT_CHANNEL_IDS);

      if (!token || allowedChannelIds.length === 0) {
        return reply.status(503).send({ error: 'Message export is not configured' });
      }

      const format = request.query.format ?? 'json';
      if (format !== 'json' && format !== 'markdown') {
        return reply.status(400).send({ error: 'format must be json or markdown' });
      }

      const hours = parseInteger(request.query.hours, DEFAULT_EXPORT_HOURS, 1);
      if (hours === null || hours > MAX_EXPORT_HOURS) {
        return reply.status(400).send({ error: 'hours must be an integer from 1 to 24' });
      }

      const parsedMaxMessages = parseInteger(
        request.query.maxMessages,
        DEFAULT_MAX_MESSAGES,
        1,
      );
      if (parsedMaxMessages === null) {
        return reply.status(400).send({ error: 'maxMessages must be a positive integer' });
      }
      const maxMessages = Math.min(parsedMaxMessages, HARD_MAX_MESSAGES);

      const requestedChannelIds = request.query.channelIds
        ? parseMessageExportChannelIds(request.query.channelIds)
        : undefined;

      try {
        const result = await exportDiscordMessages({
          token,
          allowedChannelIds,
          channelIds: requestedChannelIds,
          hours,
          maxMessages,
        });

        if (format === 'markdown') {
          return reply
            .type('text/markdown; charset=utf-8')
            .send(formatMessageExportMarkdown(result));
        }

        return result;
      } catch (err) {
        if (err instanceof InvalidMessageExportChannelsError) {
          return reply.status(400).send({
            error: err.message,
            invalidChannelIds: err.invalidChannelIds,
          });
        }
        throw err;
      }
    },
  );
}
