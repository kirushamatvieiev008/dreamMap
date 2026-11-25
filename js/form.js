/* ==========================================================================
   form.js — діалог «Нове місце» / «Редагувати місце»: поля, перевірка,
   вибір фото (клік, перетягування, вставка з буфера).
   ========================================================================== */
(function () {
  'use strict';

  const DM = window.DM;
  const { $, el, icon, createFlag } = DM.utils;

  let dialog, form;
  let fields = {};
  let mode = 'add';          // 'add' | 'edit'
  let editingId = null;
  let photo = null;          // data URL або null
  let onSubmit = () => {};
  let backdropDown = false;

  function init(callbacks) {
    onSubmit = callbacks.onSubmit;
    dialog = $('#placeDialog');
    form = $('#placeForm');

    fields = {
      city: $('#cityInput'),
      country: $('#countryInput'),
      when: $('#whenInput'),
      note: $('#noteInput'),
      cityError: $('#cityError'),
      countryError: $('#countryError'),
      flag: $('#countryFlag'),
      dropzone: $('#dropzone'),
      preview: $('#photoPreview'),
      empty: $('#dropzoneEmpty'),
      input: $('#photoInput'),
      remove: $('#photoRemove'),
      photoError: $('#photoError'),
      title: $('#dialogTitle'),
      submit: $('#submitBtn'),
    };

    // Список країн для підказок у полі
    const list = $('#countryList');
    DM.geo.countries.forEach((c) => list.append(el('option', { value: c.n })));

    // Закриття
    dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
    // Клік по затемненню: закриваємо лише якщо і натиснули, і відпустили поза вікном
    dialog.addEventListener('pointerdown', (e) => (backdropDown = e.target === dialog));
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog && backdropDown) dialog.close();
    });

    // Країна: прапорець і очищення помилок
    fields.country.addEventListener('input', updateCountryFlag);
    fields.country.addEventListener('change', updateCountryFlag);
    fields.city.addEventListener('input', () => clearError('city'));
    fields.country.addEventListener('input', () => clearError('country'));

    // Фото
    fields.dropzone.addEventListener('click', () => fields.input.click());
    fields.dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fields.input.click();
      }
    });
    fields.input.addEventListener('change', () => {
      handleFile(fields.input.files[0]);
      fields.input.value = '';
    });
    fields.remove.addEventListener('click', () => setPhoto(null));

    ['dragenter', 'dragover'].forEach((type) =>
      fields.dropzone.addEventListener(type, (e) => {
        e.preventDefault();
        fields.dropzone.classList.add('is-over');
      })
    );
    ['dragleave', 'drop'].forEach((type) =>
      fields.dropzone.addEventListener(type, () => fields.dropzone.classList.remove('is-over'))
    );
    fields.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      handleFile(e.dataTransfer.files[0]);
    });

    // Вставка зображення з буфера, поки форма відкрита
    document.addEventListener('paste', (e) => {
      if (!dialog.open) return;
      const item = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.type.startsWith('image/'));
      if (item) {
        e.preventDefault();
        handleFile(item.getAsFile());
      }
    });

    form.addEventListener('submit', handleSubmit);
  }

  /* ---------------------------------------------------------------- *
   *  Відкриття
   * ---------------------------------------------------------------- */

  /** Нове місце. Можна передати країну, яку вже вибрано на мапі. */
  function openAdd({ countryCode } = {}) {
    mode = 'add';
    editingId = null;
    form.reset();
    clearAllErrors();
    setPhoto(null);
    fields.title.textContent = 'Нове місце';
    fields.submit.textContent = 'Додати місце';
    if (countryCode) {
      const country = DM.geo.byCode.get(countryCode);
      if (country) fields.country.value = country.n;
    }
    updateCountryFlag();
    show(fields.city);
  }

  function openEdit(place) {
    mode = 'edit';
    editingId = place.id;
    form.reset();
    clearAllErrors();
    fields.title.textContent = 'Редагувати місце';
    fields.submit.textContent = 'Зберегти зміни';

    const country = DM.geo.byCode.get(place.countryCode);
    fields.city.value = place.city;
    fields.country.value = country ? country.n : '';
    fields.when.value = place.when || '';
    fields.note.value = place.note || '';
    form.elements.status.value = place.status;
    setPhoto(place.photo);
    updateCountryFlag();
    show(fields.city);
  }

  function show(focusTarget) {
    if (!dialog.open) dialog.showModal();
    // Не фокусуємо поле на дотик-екранах, щоб не вискакувала клавіатура зненацька
    if (window.matchMedia('(pointer: fine)').matches) focusTarget.focus();
  }

  /* ---------------------------------------------------------------- *
   *  Країна
   * ---------------------------------------------------------------- */
  function updateCountryFlag() {
    const country = DM.geo.findCountry(fields.country.value);
    fields.flag.replaceChildren(country ? createFlag(country.a, '', 40) : icon('globe'));
  }

  /* ---------------------------------------------------------------- *
   *  Фото
   * ---------------------------------------------------------------- */
  async function handleFile(file) {
    if (!file) return;
    fields.photoError.textContent = '';
    try {
      setPhoto(await DM.photo.fromFile(file));
    } catch (error) {
      fields.photoError.textContent = error.message;
    }
  }

  function setPhoto(dataUrl) {
    photo = dataUrl || null;
    fields.preview.hidden = !photo;
    fields.empty.hidden = !!photo;
    fields.remove.hidden = !photo;
    if (photo) fields.preview.src = photo;
    else fields.preview.removeAttribute('src');
    if (!photo) fields.photoError.textContent = '';
  }

  /* ---------------------------------------------------------------- *
   *  Перевірка й відправлення
   * ---------------------------------------------------------------- */
  function setError(name, message) {
    fields[name + 'Error'].textContent = message;
    fields[name].setAttribute('aria-invalid', 'true');
  }

  function clearError(name) {
    fields[name + 'Error'].textContent = '';
    fields[name].removeAttribute('aria-invalid');
  }

  function clearAllErrors() {
    clearError('city');
    clearError('country');
    fields.photoError.textContent = '';
  }

  function handleSubmit(e) {
    e.preventDefault();
    clearAllErrors();

    const city = fields.city.value.trim().replace(/\s+/g, ' ');
    const country = DM.geo.findCountry(fields.country.value);
    let firstInvalid = null;

    if (!city) {
      setError('city', 'Введіть назву міста.');
      firstInvalid = fields.city;
    }
    if (!fields.country.value.trim()) {
      setError('country', 'Оберіть країну.');
      firstInvalid = firstInvalid || fields.country;
    } else if (!country) {
      setError('country', 'Не знаю такої країни. Оберіть її зі списку підказок.');
      firstInvalid = firstInvalid || fields.country;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    onSubmit({
      mode,
      id: editingId,
      data: {
        city,
        countryCode: country.a,
        status: form.elements.status.value,
        when: fields.when.value.trim(),
        note: fields.note.value.trim(),
        photo,
      },
      country,
    });
    dialog.close();
  }

  DM.form = { init, openAdd, openEdit };
})();
