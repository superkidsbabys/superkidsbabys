(function () {
  'use strict';

  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function option(value, label) {
    const item = document.createElement('option');
    item.value = value;
    if (label) item.label = label;
    return item;
  }

  function initializeColombiaLocations() {
    const data = window.COLOMBIA_DIVIPOLA_2025;
    const departmentInput = document.getElementById('cart-departamento');
    const cityInput = document.getElementById('cart-ciudad');
    const departmentList = document.getElementById('departamentos-colombia');
    const cityList = document.getElementById('ciudades-colombia');
    if (!data || !departmentInput || !cityInput || !departmentList || !cityList) return;

    departmentList.replaceChildren(...data.departamentos.map((name) => option(name)));

    function renderPlaces() {
      const selectedDepartment = normalize(departmentInput.value);
      const places = selectedDepartment
        ? data.lugares.filter((place) => normalize(place.d) === selectedDepartment)
        : data.lugares.filter((place) => place.t === 'Municipio');
      const fragment = document.createDocumentFragment();
      for (const place of places) {
        const label = place.t === 'Municipio'
          ? `${place.d} · Municipio`
          : `${place.m}, ${place.d} · Centro poblado / corregimiento`;
        fragment.appendChild(option(place.n, label));
      }
      cityList.replaceChildren(fragment);
      cityInput.placeholder = selectedDepartment
        ? '🏙️ Ciudad, municipio o corregimiento'
        : '🏙️ Elige primero el departamento o escribe el lugar';
    }

    departmentInput.addEventListener('input', renderPlaces);
    departmentInput.addEventListener('change', renderPlaces);
    departmentInput.addEventListener('blur', function () {
      const typed = normalize(departmentInput.value);
      const match = data.departamentos.find((name) => normalize(name) === typed);
      if (match) departmentInput.value = match;
      renderPlaces();
    });

    cityInput.addEventListener('blur', function () {
      const department = normalize(departmentInput.value);
      const typed = normalize(cityInput.value);
      if (!typed) return;
      const matches = data.lugares.filter((place) =>
        normalize(place.n) === typed && (!department || normalize(place.d) === department),
      );
      if (matches.length === 1) {
        cityInput.value = matches[0].n;
        if (!departmentInput.value) departmentInput.value = matches[0].d;
      }
    });

    renderPlaces();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeColombiaLocations, { once: true });
  } else {
    initializeColombiaLocations();
  }
}());
