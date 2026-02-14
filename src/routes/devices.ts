import type { FastifyInstance } from 'fastify';
import { listDevicePresets } from '../renderer/devices.js';

export async function devicesRoutes(app: FastifyInstance) {
  app.get('/v1/devices', {
    schema: {
      tags: ['devices'],
      summary: 'List available device presets',
      description: 'Get a list of all available device emulation presets for mobile and desktop viewports.',
      response: {
        200: {
          type: 'object',
          properties: {
            devices: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Device preset ID (use this in the device parameter)' },
                  name: { type: 'string', description: 'Human-readable device name' },
                  width: { type: 'number', description: 'Viewport width in pixels' },
                  height: { type: 'number', description: 'Viewport height in pixels' },
                  deviceScaleFactor: { type: 'number', description: 'Device pixel ratio' },
                  isMobile: { type: 'boolean', description: 'Whether this is a mobile device' },
                  hasTouch: { type: 'boolean', description: 'Whether this device supports touch events' },
                  userAgent: { type: 'string', description: 'User agent string for this device' },
                },
              },
            },
          },
        },
      },
    },
  }, async (_req, reply) => {
    const devices = listDevicePresets();
    return reply.status(200).send({ devices });
  });
}
