import * as THREE from "three";

const SIGN_WIDTH = 512;
const SIGN_HEIGHT = 168;

/**
 * Draws a neon billboard into a canvas texture. Using a canvas keeps Chinese
 * glyphs available without shipping an extra font file.
 */
export function makeNeonSignTexture(
  title: string,
  subtitle: string,
  color: string,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = SIGN_WIDTH;
  canvas.height = SIGN_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, SIGN_WIDTH, SIGN_HEIGHT);

    const gradient = ctx.createLinearGradient(0, 0, SIGN_WIDTH, SIGN_HEIGHT);
    gradient.addColorStop(0, "rgba(4, 10, 16, 0.94)");
    gradient.addColorStop(1, "rgba(8, 14, 24, 0.86)");
    ctx.fillStyle = gradient;
    ctx.fillRect(6, 8, SIGN_WIDTH - 12, SIGN_HEIGHT - 16);

    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.strokeRect(9, 11, SIGN_WIDTH - 18, SIGN_HEIGHT - 22);
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
    for (let y = 20; y < SIGN_HEIGHT - 18; y += 6) {
      ctx.fillRect(14, y, SIGN_WIDTH - 28, 1);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.fillStyle = color;
    ctx.font = '700 58px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.fillText(clampText(ctx, title, SIGN_WIDTH - 60), SIGN_WIDTH / 2, 68);

    ctx.shadowBlur = 8;
    ctx.fillStyle = "rgba(220, 244, 255, 0.78)";
    ctx.font = '400 24px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.fillText(clampText(ctx, subtitle, SIGN_WIDTH - 80), SIGN_WIDTH / 2, 122);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function clampText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}
