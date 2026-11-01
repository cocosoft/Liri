/**
 * MultimediaMCPTools
 * 多媒体 MCP 工具定义
 * 将本地 image/voice 工具注册为 MCP 协议可用工具
 */
import type { MCPToolDefinition } from './types/index';

/**
 * 获取多媒体工具列表
 * 以 MCPToolDefinition 格式返回，供 MCP 服务端注册
 */
export function getMultimediaMCPTools(): MCPToolDefinition[] {
  return [
    {
      name: 'image_generate',
      description: 'Generate images using AI (DALL-E, Stability AI)',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Text description of the image',
          },
          size: {
            type: 'string',
            enum: ['256x256', '512x512', '1024x1024'],
            description: 'Image size',
          },
          n: { type: 'number', description: 'Number of images (1-4)' },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'image_analysis',
      description: 'Analyze image metadata, colors, content',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['metadata', 'colors', 'content', 'vision'],
            description: 'Analysis action type',
          },
          inputPath: { type: 'string', description: 'Path to image file' },
        },
        required: ['action', 'inputPath'],
      },
    },
    {
      name: 'voice_tts',
      description: 'Convert text to speech',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to convert to speech' },
          provider: {
            type: 'string',
            enum: ['edge', 'openai'],
            description: 'TTS provider',
          },
        },
        required: ['text'],
      },
    },
  ];
}
