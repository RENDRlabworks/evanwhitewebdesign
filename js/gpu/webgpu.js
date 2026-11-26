/**
 * WebGPU backend. Returns null when WebGPU is missing or refuses to start,
 * so the stage can fall back to WebGL2.
 */
import { wgsl, buildMesh } from './shaders.js';

export async function createWebGPU(canvas, { lite, onLost }) {
  if (!('gpu' in navigator)) return null;

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: lite ? 'low-power' : 'high-performance',
  });
  if (!adapter) return null;

  const device = await adapter.requestDevice();
  const ctx = canvas.getContext('webgpu');
  if (!ctx) return null;

  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'premultiplied' });

  const module = device.createShaderModule({ code: wgsl(lite) });
  const blend = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vs',
      buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }],
    },
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: blend, alpha: blend } }] },
    primitive: { topology: 'triangle-list' },
  });

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });

  const mesh = buildMesh(lite ? 16 : 40);
  const vbo = device.createBuffer({ size: mesh.verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vbo, 0, mesh.verts);
  const ibo = device.createBuffer({ size: mesh.idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ibo, 0, mesh.idx);

  device.lost.then((info) => {
    if (info.reason !== 'destroyed') onLost?.();
  });

  return {
    kind: 'webgpu',

    /** levels: array of canvases/bitmaps, largest first (a prebuilt mip chain). */
    createTexture(levels) {
      const { width, height } = levels[0];
      const texture = device.createTexture({
        size: [width, height],
        format: 'rgba8unorm',
        mipLevelCount: levels.length,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      levels.forEach((source, mipLevel) => {
        device.queue.copyExternalImageToTexture(
          { source },
          { texture, mipLevel },
          [source.width, source.height]
        );
      });
      return texture;
    },

    createPlane(texture) {
      const ubo = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: ubo } },
          { binding: 1, resource: sampler },
          { binding: 2, resource: texture.createView() },
        ],
      });
      return { ubo, bindGroup };
    },

    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
    },

    /** items: [{ plane, data: Float32Array(16) }]. Clears, then draws in order. */
    render(items) {
      for (const item of items) device.queue.writeBuffer(item.plane.ubo, 0, item.data);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: ctx.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      if (items.length) {
        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, vbo);
        pass.setIndexBuffer(ibo, 'uint16');
        for (const item of items) {
          pass.setBindGroup(0, item.plane.bindGroup);
          pass.drawIndexed(mesh.idx.length);
        }
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
    },

    destroy() {
      device.destroy();
    },
  };
}
