/** 8×8 average hash, 16 hex chars. Empty string if the image cannot be read. */
export function averageHash(src: string): Promise<string> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || !src) {
      resolve("");
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        resolve("");
        return;
      }
      ctx.drawImage(img, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      const gray: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        gray.push((data[i] ?? 0) * 0.299 + (data[i + 1] ?? 0) * 0.587 + (data[i + 2] ?? 0) * 0.114);
      }
      const avg = gray.reduce((sum, value) => sum + value, 0) / gray.length;
      let bits = "";
      for (const value of gray) bits += value >= avg ? "1" : "0";
      let hex = "";
      for (let i = 0; i < 64; i += 4) {
        hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
      }
      resolve(hex);
    };
    img.onerror = () => resolve("");
    img.src = src;
  });
}
