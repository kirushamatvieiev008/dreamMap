/* ==========================================================================
   photo.js — підготовка фото: зменшення й стиснення перед збереженням.
   Фото зберігаються в localStorage як текст (data URL), а він має ліміт ~5 МБ,
   тому великі знімки з телефона стискаємо до розумного розміру.
   ========================================================================== */
(function () {
  'use strict';

  const DM = window.DM;

  const MAX_SIDE = 1100;      // найбільша сторона після зменшення, px
  const QUALITY = 0.8;        // якість JPEG
  const MAX_FILE_MB = 25;     // більші файли навіть не намагаємось читати

  function loadImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => loadViaElement(file));
    }
    return loadViaElement(file);
  }

  function loadViaElement(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('decode'));
      };
      img.src = url;
    });
  }

  /**
   * Перетворює файл-зображення на стиснутий JPEG data URL.
   * Кидає помилку з текстом, зрозумілим користувачу.
   */
  async function fromFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      throw new Error('Оберіть файл із зображенням: JPG, PNG або WebP.');
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      throw new Error(`Файл завеликий. Максимум ${MAX_FILE_MB} МБ.`);
    }

    let image;
    try {
      image = await loadImage(file);
    } catch (error) {
      throw new Error('Не вдалося прочитати це зображення. Спробуйте JPG або PNG.');
    }

    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    const ratio = Math.min(1, MAX_SIDE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * ratio));
    const h = Math.max(1, Math.round(height * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // для PNG із прозорістю
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, w, h);
    if (image.close) image.close();

    return canvas.toDataURL('image/jpeg', QUALITY);
  }

  DM.photo = { fromFile };
})();
