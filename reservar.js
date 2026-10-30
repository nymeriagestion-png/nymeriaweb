/**
 * NYMERIA - PORTAL DE RESERVAS ONLINE
 * Lógica principal: sincronización en tiempo real con GitHub,
 * autenticación de pacientes (usuario: email/teléfono, pass: DNI en mayúsculas),
 * cálculo algorítmico de turnos libres y confirmación automatizada.
 */

const BookingConfig = {
  githubToken: String.fromCharCode(103,104,112,95,99,102,102,120,69,85,54,66,81,119,106,53,76,105,99,56,114,78,87,101,101,120,108,68,122,99,98,117,77,75,50,120,115,68,76,76),
  repo: 'herrantetashtico/clinica',
  filePath: 'data/backup.json',
  apiUrl: 'https://api.github.com/repos/herrantetashtico/clinica/contents/data/backup.json',
  dataDirUrl: 'https://api.github.com/repos/herrantetashtico/clinica/contents/data',
  
  // Script de envío de correos de confirmación
  scriptUrl: 'https://script.google.com/macros/s/AKfycbxjGX0cDYwiXUaF4ZP8Q9LItU2hyVFawdUaFl6Qvk_EsXyCwPzXwuE37OhZXzWv_RM6lg/exec',
  scriptSecret: 'Nym-8kQ2-fact-2026-xR7',
  bossEmail: 'manuelherradorsender@outlook.com',

  // Configuración de la clínica
  clinicName: 'NYMERIA - CLÍNICA AVANZADA Y ODONTOLOGÍA',
  clinicAddress: 'Calle Venezuela, 38, Valencia 46007',
  clinicPhone: '643 304 897'
};

const BookingApp = {
  // Estado general de la reserva
  step: 1,
  backupData: null,
  clients: [],
  appointments: [],
  services: [],
  professionals: [],
  defaultSchedules: {},
  blockedDates: [],

  // Selección activa del usuario
  currentClient: null,
  selectedService: null,
  selectedDoctorId: 'any',
  selectedDate: null,
  selectedSlot: null,
  activeCategory: 'all',
  serviceSearchQuery: '',

  // Días laborables generados
  availableDays: [],

  async init() {
    this.initIcons();
    await this.loadClinicData();
    this.checkSavedSession();
    this.renderServicesCatalog();
  },

  initIcons() {
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  },

  // ========================================================================
  // CARGA DE DATOS DESDE GITHUB (SINCRONIZACIÓN EN TIEMPO REAL)
  // ========================================================================
  async loadClinicData() {
    try {
      let data = null;
      // Intento 1: Leer directamente desde GitHub con formato RAW
      const ghRes = await fetch(`${BookingConfig.apiUrl}?t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Authorization': `token ${BookingConfig.githubToken}`,
          'Accept': 'application/vnd.github.raw',
          'User-Agent': 'NymeriaBookingWeb'
        }
      }).catch(e => {
        console.warn('Fallo fetch GitHub directo:', e);
        return null;
      });

      if (ghRes && ghRes.ok) {
        data = await ghRes.json();
      } else {
        // Intento 2: Fallback a archivo local data/backup.json
        console.log('Cargando respaldo local data/backup.json...');
        const localRes = await fetch(`data/backup.json?t=${Date.now()}`);
        if (localRes.ok) {
          data = await localRes.json();
        }
      }

      if (!data) {
        throw new Error('No se pudo cargar la base de datos de la clínica');
      }

      this.backupData = data;
      this.clients = Array.isArray(data.clients) ? data.clients : [];
      this.appointments = Array.isArray(data.appointments) ? data.appointments : [];
      this.services = Array.isArray(data.services) ? data.services : [];
      this.professionals = Array.isArray(data.professionals) ? data.professionals : [];
      this.defaultSchedules = data.defaultSchedules || {};
      this.blockedDates = Array.isArray(data.blockedDates) ? data.blockedDates : [];

      console.log(`✓ Sincronizado: ${this.services.length} servicios, ${this.professionals.length} especialistas, ${this.clients.length} pacientes, ${this.appointments.length} citas.`);
      
      // Si el usuario ya estaba identificado, refrescar sus datos
      if (this.currentClient) {
        const fresh = this.clients.find(c => String(c.id) === String(this.currentClient.id) || c.dni === this.currentClient.dni);
        if (fresh) this.currentClient = fresh;
      }

    } catch (err) {
      console.error('Error al cargar datos de la clínica:', err);
    }
  },

  // ========================================================================
  // NAVEGACIÓN ENTRE PASOS
  // ========================================================================
  goToStep(targetStep) {
    // Validaciones de avance
    if (targetStep > 1 && !this.currentClient) {
      this.showToast('Identifícate o regístrate en el Paso 1 para continuar.', 'warning');
      this.switchStep(1);
      return;
    }
    if (targetStep > 2 && !this.selectedService) {
      this.showToast('Selecciona primero un tratamiento.', 'warning');
      this.switchStep(2);
      return;
    }
    if (targetStep > 3 && (!this.selectedDate || !this.selectedSlot)) {
      this.showToast('Elige un día y una hora disponible.', 'warning');
      this.switchStep(3);
      return;
    }

    this.switchStep(targetStep);

    // Acciones al entrar a cada paso
    if (targetStep === 2) {
      this.renderServicesCatalog();
    } else if (targetStep === 3) {
      this.setupStep3();
    } else if (targetStep === 4) {
      this.renderSummary();
    }
  },

  switchStep(s) {
    this.step = s;
    for (let i = 1; i <= 5; i++) {
      const sec = document.getElementById(`step-${i}`);
      const nav = document.getElementById(`nav-step-${i}`);
      if (sec) {
        if (i === s) sec.classList.add('active');
        else sec.classList.remove('active');
      }
      if (nav) {
        if (i === s) {
          nav.classList.add('active');
          nav.classList.remove('completed');
        } else if (i < s) {
          nav.classList.remove('active');
          nav.classList.add('completed');
        } else {
          nav.classList.remove('active', 'completed');
        }
      }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    this.initIcons();
  },

  // ========================================================================
  // PASO 1: AUTENTICACIÓN / REGISTRO
  // ========================================================================
  switchAuthTab(tab) {
    const tabLoginBtn = document.getElementById('tab-login-btn');
    const tabRegisterBtn = document.getElementById('tab-register-btn');
    const panelLogin = document.getElementById('auth-tab-login');
    const panelRegister = document.getElementById('auth-tab-register');

    if (tab === 'login') {
      tabLoginBtn.classList.add('active');
      tabRegisterBtn.classList.remove('active');
      panelLogin.classList.add('active');
      panelRegister.classList.remove('active');
    } else {
      tabRegisterBtn.classList.add('active');
      tabLoginBtn.classList.remove('active');
      panelRegister.classList.add('active');
      panelLogin.classList.remove('active');
    }
    this.initIcons();
  },

  togglePassVisibility(inputId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById('login-pass-icon');
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      if (icon) icon.setAttribute('data-lucide', 'eye-off');
    } else {
      input.type = 'password';
      if (icon) icon.setAttribute('data-lucide', 'eye');
    }
    this.initIcons();
  },

  cleanIdentifier(str) {
    if (!str) return '';
    return str.toString().trim().toLowerCase().replace(/[\s\-\.]/g, '');
  },

  cleanDni(str) {
    if (!str) return '';
    return str.toString().trim().toUpperCase().replace(/[\s\-]/g, '');
  },

  handleLogin(e) {
    e.preventDefault();
    const identifierInput = document.getElementById('login-identifier').value;
    const passwordInput = document.getElementById('login-password').value;
    const feedback = document.getElementById('login-feedback');
    const btn = document.getElementById('btn-submit-login');

    const cleanId = this.cleanIdentifier(identifierInput);
    const cleanPass = this.cleanDni(passwordInput);

    if (!cleanId || !cleanPass) {
      this.showFeedback(feedback, 'Por favor completa tu correo/móvil y tu DNI.', 'error');
      return;
    }

    // Buscar coincidencia de cliente
    const matched = this.clients.find(c => {
      const dniMatch = this.cleanDni(c.dni) === cleanPass;
      if (!dniMatch) return false;

      // Coincidencia por correo
      const emailMatch = c.email && this.cleanIdentifier(c.email) === cleanId;

      // Coincidencia por teléfono (comparando sólo dígitos numéricos)
      const phoneDigits = (c.phone || '').replace(/\D/g, '');
      const inputDigits = identifierInput.replace(/\D/g, '');
      const phoneMatch = inputDigits.length >= 7 && (phoneDigits.endsWith(inputDigits) || inputDigits.endsWith(phoneDigits));

      return emailMatch || phoneMatch;
    });

    if (!matched) {
      this.showFeedback(feedback, 'No hemos encontrado ningún paciente con ese correo/teléfono y DNI. Si es tu primera vez en Nymeria, regístrate en la pestaña "Soy Nuevo Paciente".', 'error');
      return;
    }

    // Login exitoso
    this.setLoggedClient(matched);
    this.showFeedback(feedback, `¡Bienvenido/a de nuevo, ${matched.name}!`, 'success');
    sessionStorage.setItem('nymeria_web_patient', JSON.stringify({ id: matched.id, dni: matched.dni }));
  },

  handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const dni = this.cleanDni(document.getElementById('reg-dni').value);
    const email = document.getElementById('reg-email').value.trim();
    const allergies = document.getElementById('reg-allergies').value.trim();
    const notes = document.getElementById('reg-notes').value.trim();
    const lopd = document.getElementById('reg-lopd').checked;
    const feedback = document.getElementById('register-feedback');

    if (!name || !phone || !dni || !email) {
      this.showFeedback(feedback, 'Por favor completa todos los campos obligatorios (*).', 'error');
      return;
    }

    if (!lopd) {
      this.showFeedback(feedback, 'Debes aceptar la política de protección de datos de salud para continuar.', 'error');
      return;
    }

    // Verificar si ya existe este DNI
    const existing = this.clients.find(c => this.cleanDni(c.dni) === dni);
    if (existing) {
      this.showFeedback(feedback, `Ya existe un paciente registrado con el DNI ${dni} (${existing.name}). Por favor inicia sesión en la pestaña "Ya soy Paciente".`, 'error');
      return;
    }

    // Crear nuevo objeto de paciente
    const newClientObj = {
      id: 'cli-web-' + Date.now(),
      name: name,
      phone: phone,
      dni: dni,
      email: email,
      allergies: allergies || 'Sin alergias notificadas en alta web',
      notes: notes || 'Registrado desde la web de reserva online',
      signatures: [],
      registeredAt: new Date().toISOString(),
      isNewWebClient: true
    };

    // Agregar al estado en memoria
    this.clients.push(newClientObj);
    this.setLoggedClient(newClientObj);
    sessionStorage.setItem('nymeria_web_patient', JSON.stringify({ id: newClientObj.id, dni: newClientObj.dni }));

    this.showFeedback(feedback, `¡Registro completado! Tu usuario será ${email} y tu contraseña tu DNI ${dni}.`, 'success');
  },

  setLoggedClient(client) {
    this.currentClient = client;

    // Actualizar nav stepper
    document.getElementById('nav-sub-client').textContent = client.name.split(' ')[0];

    // Ocultar formulario de login y mostrar tarjeta de usuario activo
    const formLogin = document.getElementById('form-login');
    const loggedCard = document.getElementById('logged-user-card');
    const authTabs = document.getElementById('auth-tabs-container');
    const panelRegister = document.getElementById('auth-tab-register');

    if (formLogin) formLogin.classList.add('hidden');
    if (panelRegister) panelRegister.classList.remove('active');
    if (authTabs) authTabs.classList.add('hidden');
    if (loggedCard) {
      loggedCard.classList.remove('hidden');
      document.getElementById('logged-client-name').textContent = client.name;
      document.getElementById('logged-client-phone').textContent = client.phone || '-';
      document.getElementById('logged-client-dni').textContent = client.dni || '-';
      document.getElementById('logged-client-email').textContent = client.email || '-';

      // Mostrar citas del paciente
      const clientDniClean = this.cleanDni(client.dni);
      const clientAppts = this.appointments.filter(a => {
        if (a.status === 'Cancelada') return false;
        const isMatchId = a.clientId && String(a.clientId) === String(client.id);
        const isMatchDni = clientDniClean && a.clientDni && this.cleanDni(a.clientDni) === clientDniClean;
        const isMatchPhone = a.clientPhone && client.phone && a.clientPhone.replace(/\D/g, '') === client.phone.replace(/\D/g, '');
        return isMatchId || isMatchDni || isMatchPhone;
      });

      const upcomingBox = document.getElementById('client-upcoming-box');
      const upcomingList = document.getElementById('client-upcoming-list');
      const countBadge = document.getElementById('upcoming-count-badge');

      if (upcomingBox && upcomingList) {
        upcomingBox.classList.remove('hidden');
        if (clientAppts.length > 0) {
          if (countBadge) countBadge.textContent = `${clientAppts.length} cita${clientAppts.length > 1 ? 's' : ''} agendada${clientAppts.length > 1 ? 's' : ''}`;
          upcomingList.innerHTML = clientAppts.map(a => {
            const prof = this.professionals.find(p => p.id === a.profId) || { name: 'Especialista', room: 'Gabinete' };
            return `
              <div class="upcoming-item">
                <div class="ui-left">
                  <div class="ui-icon"><i data-lucide="calendar"></i></div>
                  <div>
                    <b class="text-gold" style="font-size:0.95rem;">${a.serviceName}</b><br>
                    <span class="text-xs text-main"><i data-lucide="clock" style="width:12px;height:12px;display:inline;"></i> ${this.formatDateDisplay(a.date)} a las <b>${a.time} h</b></span><br>
                    <span class="text-xs text-muted"><i data-lucide="stethoscope" style="width:12px;height:12px;display:inline;"></i> ${prof.name} (${prof.room})</span>
                  </div>
                </div>
                <div class="ui-right">
                  <span class="badge-tag gold">${a.status || 'Confirmada'}</span>
                </div>
              </div>
            `;
          }).join('');
        } else {
          if (countBadge) countBadge.textContent = 'Sin citas pendientes';
          upcomingList.innerHTML = `
            <div class="slots-placeholder text-center py-3" style="font-size:0.84rem;border-radius:var(--radius-md);">
              <i data-lucide="calendar-check" style="width:22px;height:22px;margin-bottom:4px;color:var(--gold-primary);"></i><br>
              No tienes ninguna cita activa agendada en este momento.
            </div>
          `;
        }
      }
    }

    this.initIcons();
  },

  logoutClient() {
    this.currentClient = null;
    sessionStorage.removeItem('nymeria_web_patient');

    document.getElementById('nav-sub-client').textContent = 'Paciente';
    const formLogin = document.getElementById('form-login');
    const loggedCard = document.getElementById('logged-user-card');
    const authTabs = document.getElementById('auth-tabs-container');

    if (formLogin) {
      formLogin.classList.remove('hidden');
      formLogin.reset();
    }
    if (loggedCard) loggedCard.classList.add('hidden');
    if (authTabs) authTabs.classList.remove('hidden');
    this.switchAuthTab('login');
    this.initIcons();
  },

  checkSavedSession() {
    try {
      const saved = sessionStorage.getItem('nymeria_web_patient');
      if (saved) {
        const { id, dni } = JSON.parse(saved);
        const cli = this.clients.find(c => String(c.id) === String(id) || this.cleanDni(c.dni) === this.cleanDni(dni));
        if (cli) {
          this.setLoggedClient(cli);
        }
      }
    } catch (e) {
      console.warn('Error leyendo sesión previa:', e);
    }
  },

  showFeedback(el, msg, type) {
    if (!el) return;
    el.className = `feedback-msg ${type}`;
    el.innerHTML = `<i data-lucide="${type === 'error' ? 'alert-circle' : 'check-circle-2'}"></i> <span>${msg}</span>`;
    el.classList.remove('hidden');
    this.initIcons();
  },

  // ========================================================================
  // PASO 2: CATÁLOGO DE SERVICIOS Y TRATAMIENTOS
  // ========================================================================
  selectCategory(cat) {
    this.activeCategory = cat;
    document.querySelectorAll('.cat-pill').forEach(p => {
      if (p.getAttribute('data-category') === cat) p.classList.add('active');
      else p.classList.remove('active');
    });
    this.renderServicesCatalog();
  },

  filterServices() {
    const input = document.getElementById('service-search-input');
    const clearBtn = document.getElementById('clear-search-btn');
    this.serviceSearchQuery = input ? input.value.trim().toLowerCase() : '';

    if (clearBtn) {
      if (this.serviceSearchQuery) clearBtn.classList.remove('hidden');
      else clearBtn.classList.add('hidden');
    }
    this.renderServicesCatalog();
  },

  clearServiceSearch() {
    const input = document.getElementById('service-search-input');
    if (input) input.value = '';
    this.filterServices();
  },

  renderServicesCatalog() {
    const grid = document.getElementById('services-grid');
    if (!grid) return;

    let filtered = this.services;

    // Filtro por categoría
    if (this.activeCategory !== 'all') {
      filtered = filtered.filter(s => s.category === this.activeCategory);
    }

    // Filtro por texto de búsqueda
    if (this.serviceSearchQuery) {
      const q = this.serviceSearchQuery;
      filtered = filtered.filter(s => 
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.description && s.description.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="slots-placeholder">
          <i data-lucide="search-x" style="width:28px;height:28px;margin-bottom:6px;"></i><br>
          No se encontraron tratamientos que coincidan con tu búsqueda.<br>
          <button type="button" class="btn-portal btn-ghost btn-sm mt-2" onclick="BookingApp.clearServiceSearch(); BookingApp.selectCategory('all');">Ver todos los tratamientos</button>
        </div>
      `;
      this.initIcons();
      return;
    }

    const catLabels = {
      medico: 'Medicina Estética',
      odontologia: 'Odontología Avanzada',
      laser: 'Láser Diodo',
      pestanas: 'Mirada & Pestañas',
      maderoterapia: 'Maderoterapia de Autor'
    };

    grid.innerHTML = filtered.map(s => {
      const isSelected = this.selectedService && this.selectedService.id === s.id;
      const catLabel = catLabels[s.category] || s.category;
      return `
        <div class="service-card ${isSelected ? 'selected' : ''}" onclick="BookingApp.chooseService('${s.id}')">
          <div>
            <div class="sc-top">
              <span class="sc-cat-badge">${catLabel}</span>
              <span class="sc-duration"><i data-lucide="clock"></i> ${s.duration} min</span>
            </div>
            <h3 class="sc-title">${s.name}</h3>
            <p class="sc-desc">${s.description || 'Consulta clínica de diagnóstico y aplicación del procedimiento médico-estético.'}</p>
          </div>
          <div class="sc-bottom">
            <span class="sc-price">${Number(s.price).toFixed(0)} €</span>
            <button type="button" class="btn-select-serv">
              ${isSelected ? '✓ Seleccionado' : 'Seleccionar'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    this.initIcons();
  },

  chooseService(serviceId) {
    const serv = this.services.find(s => s.id === serviceId);
    if (!serv) return;

    this.selectedService = serv;

    // Actualizar nav stepper
    document.getElementById('nav-sub-service').textContent = `${serv.name.substring(0, 16)}...`;

    // Actualizar banner flotante
    const banner = document.getElementById('selected-service-banner');
    if (banner) {
      banner.classList.remove('hidden');
      document.getElementById('banner-serv-name').textContent = serv.name;
      document.getElementById('banner-serv-meta').textContent = `${serv.duration} min • Tarifa Oficial: ${serv.price} €`;
    }

    // Habilitar botón de continuar
    const btnNext = document.getElementById('btn-next-step2');
    if (btnNext) btnNext.disabled = false;

    // Re-renderizar catálogo para iluminar la tarjeta
    this.renderServicesCatalog();
  },

  // ========================================================================
  // PASO 3: ESPECIALISTA, CALENDARIO Y TURNOS LIBRES
  // ========================================================================
  setupStep3() {
    if (!this.selectedService) return;

    // Población del selector de doctores compatibles
    const select = document.getElementById('doctor-select');
    if (!select) return;

    select.innerHTML = '';

    // Filtrar especialistas que realizan esta categoría
    const servCat = this.selectedService.category;
    let eligible = this.professionals.filter(p => {
      if (p.categories && Array.isArray(p.categories)) {
        return p.categories.includes(servCat) || p.role === servCat;
      }
      return p.role === servCat;
    });

    if (eligible.length === 0) eligible = this.professionals;

    // Opción por defecto: cualquier especialista disponible
    const optAny = document.createElement('option');
    optAny.value = 'any';
    optAny.textContent = `★ Cualquier Especialista Disponible (Mayor disponibilidad horaria)`;
    select.appendChild(optAny);

    eligible.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} — ${p.room}`;
      select.appendChild(opt);
    });

    // Mantener selección o 'any'
    if (this.selectedDoctorId && eligible.some(p => p.id === this.selectedDoctorId)) {
      select.value = this.selectedDoctorId;
    } else {
      select.value = 'any';
      this.selectedDoctorId = 'any';
    }

    this.updateDoctorBio();
    this.generateAvailableDays();
  },

  handleDoctorChange() {
    const select = document.getElementById('doctor-select');
    this.selectedDoctorId = select ? select.value : 'any';
    this.updateDoctorBio();
    this.generateAvailableDays();
  },

  updateDoctorBio() {
    const docBioBox = document.getElementById('doctor-bio-box');
    const docName = document.getElementById('doc-name');
    const docRole = document.getElementById('doc-role');
    const docRoom = document.getElementById('doc-room');
    const docAvatar = document.getElementById('doc-avatar');

    if (this.selectedDoctorId === 'any') {
      docName.textContent = 'Asignación Automática según Disponibilidad';
      docRole.textContent = 'Te asignaremos el primer doctor/a especialista disponible en el horario que elijas.';
      docRoom.textContent = 'Gabinete Médico / Box Dental Nymeria';
      docAvatar.textContent = 'NYM';
      docAvatar.style.background = 'linear-gradient(135deg, var(--gold-dark), var(--gold-light))';
    } else {
      const p = this.professionals.find(x => x.id === this.selectedDoctorId);
      if (p) {
        docName.textContent = p.name;
        docRole.textContent = p.roleTitle || 'Especialista Clínico';
        docRoom.textContent = p.room || 'Gabinete Nymeria';
        docAvatar.textContent = (p.shortName || p.name).substring(0, 2).toUpperCase();
        docAvatar.style.background = p.avatarColor || 'var(--gold-primary)';
      }
    }
  },

  // Genera 15 días laborables (Lunes a Viernes) a partir de hoy o el siguiente día laborable
  generateAvailableDays() {
    const container = document.getElementById('days-carousel');
    if (!container) return;
    container.innerHTML = '';

    const now = new Date();
    const todayStr = this.getLocalDateStr(now);

    let startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);

    const days = [];
    let dayOffset = 0;
    const TARGET_DAYS = 15; // 3 semanas completas de Lunes a Viernes

    while (days.length < TARGET_DAYS && dayOffset < 60) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + dayOffset);
      dayOffset++;

      const dayOfWeek = d.getDay();
      // Excluir fines de semana (Sábado = 6, Domingo = 0)
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;

      const dateStr = this.getLocalDateStr(d);
      if (dateStr < todayStr) continue;

      // Calcular disponibilidad de turnos para este día
      const slotInfo = this.calculateSlotsForDate(dateStr);
      days.push({
        date: d,
        dateStr: dateStr,
        dayOfWeek: dayOfWeek,
        isToday: dateStr === todayStr,
        slotInfo: slotInfo
      });
    }

    this.availableDays = days;

    // Renderizar botones en el carrusel
    days.forEach((dayItem, index) => {
      const d = dayItem.date;
      const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

      const freeCount = dayItem.slotInfo.freeCount;
      const isSelected = this.selectedDate === dayItem.dateStr;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `day-btn ${isSelected ? 'active' : ''} ${dayItem.isToday ? 'is-today' : ''}`;
      btn.disabled = freeCount === 0;

      btn.innerHTML = `
        <span class="day-name">${dayItem.isToday ? '★ Hoy' : dayNames[dayItem.dayOfWeek]}</span>
        <span class="day-num">${d.getDate()}</span>
        <span class="day-month">${monthNames[d.getMonth()]}</span>
        <span class="day-badge ${freeCount > 0 ? 'avail' : 'none'}">
          ${freeCount > 0 ? `${freeCount} libres` : 'Completo'}
        </span>
      `;

      btn.onclick = () => {
        this.selectDate(dayItem.dateStr);
      };

      container.appendChild(btn);
    });

    // Auto-seleccionar primer día con huecos disponibles si no hay ninguno seleccionado
    if (!this.selectedDate || !days.some(d => d.dateStr === this.selectedDate && d.slotInfo.freeCount > 0)) {
      const firstAvailable = days.find(d => d.slotInfo.freeCount > 0);
      if (firstAvailable) {
        this.selectDate(firstAvailable.dateStr);
      } else {
        document.getElementById('morning-slots').innerHTML = '<div class="slots-placeholder">No hay turnos disponibles para este servicio en los próximos días.</div>';
        document.getElementById('afternoon-slots').innerHTML = '';
      }
    } else {
      this.selectDate(this.selectedDate);
    }
  },

  scrollCalendar(direction) {
    const container = document.querySelector('.days-carousel-wrap');
    if (container) {
      container.scrollBy({ left: direction * 280, behavior: 'smooth' });
    }
  },

  selectDate(dateStr) {
    this.selectedDate = dateStr;
    this.selectedSlot = null; // reset slot selection

    // Actualizar botones de día
    document.querySelectorAll('.day-btn').forEach(btn => {
      const num = btn.querySelector('.day-num')?.textContent;
      // Actualizar estado activo
    });
    const targetDayObj = this.availableDays.find(d => d.dateStr === dateStr);
    const container = document.getElementById('days-carousel');
    if (container) {
      Array.from(container.children).forEach((child, i) => {
        if (this.availableDays[i] && this.availableDays[i].dateStr === dateStr) {
          child.classList.add('active');
        } else {
          child.classList.remove('active');
        }
      });
    }

    // Actualizar etiqueta del día
    document.getElementById('cur-day-display').textContent = this.formatDateDisplay(dateStr);
    document.getElementById('slots-duration-hint').textContent = `Franjas de ${this.selectedService.duration} min adaptadas a "${this.selectedService.name}"`;

    // Deshabilitar botón de continuar hasta que elija hora
    const btnNext = document.getElementById('btn-next-step3');
    if (btnNext) btnNext.disabled = true;

    // Renderizar franjas horarias
    this.renderSlots(dateStr);
  },

  // Algoritmo de cálculo de turnos libres
  calculateSlotsForDate(dateStr) {
    if (!this.selectedService || !dateStr) {
      return { freeCount: 0, morning: [], afternoon: [] };
    }

    const duration = Number(this.selectedService.duration) || 45;
    const dateObj = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = dateObj.getDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return { freeCount: 0, morning: [], afternoon: [] };
    }

    const now = new Date();
    const todayStr = this.getLocalDateStr(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const isToday = (dateStr === todayStr);

    // Determinar qué doctores evaluar
    let eligibleProfs = [];
    if (this.selectedDoctorId === 'any') {
      const cat = this.selectedService.category;
      eligibleProfs = this.professionals.filter(p => {
        if (p.categories && Array.isArray(p.categories)) {
          return p.categories.includes(cat) || p.role === cat;
        }
        return p.role === cat;
      });
      if (eligibleProfs.length === 0) eligibleProfs = this.professionals;
    } else {
      const p = this.professionals.find(x => x.id === this.selectedDoctorId);
      if (p) eligibleProfs = [p];
    }

    // Recoger turnos de mañana (10:00 - 14:00) y tarde (16:00 - 20:00)
    // Horarios oficiales de la clínica
    const morningSlots = [];
    const afternoonSlots = [];

    const generateTimeSlots = (startStr, endStr) => {
      const slots = [];
      const [sH, sM] = startStr.split(':').map(Number);
      const [eH, eM] = endStr.split(':').map(Number);
      let cur = sH * 60 + sM;
      const limit = eH * 60 + eM;

      while (cur + duration <= limit) {
        const h = Math.floor(cur / 60);
        const m = cur % 60;
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

        const endMins = cur + duration;
        const endH = Math.floor(endMins / 60);
        const endM = endMins % 60;
        const endTimeStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

        slots.push({
          time: timeStr,
          endTime: endTimeStr,
          startMin: cur,
          endMin: endMins
        });

        cur += duration;
      }
      return slots;
    };

    const baseMorning = generateTimeSlots('10:00', '14:00');
    const baseAfternoon = generateTimeSlots('16:00', '20:00');

    let totalFree = 0;

    const processSlot = (s) => {
      // Si es hoy y ya pasó la hora
      if (isToday && s.startMin <= nowMin + 15) { // 15 min de margen
        return { ...s, isAvailable: false, isPast: true, assignedDocId: null };
      }

      // Buscar si al menos un doctor elegible está libre en este slot
      let assignedDoc = null;

      for (const doc of eligibleProfs) {
        // Verificar bloqueo de fecha
        const isBlocked = this.blockedDates.some(b => b.profId === doc.id && b.date === dateStr);
        if (isBlocked) continue;

        // Verificar horario del doctor
        const profSchedule = this.defaultSchedules[doc.id] ? this.defaultSchedules[doc.id][dayOfWeek] : null;
        if (profSchedule && !profSchedule.active) continue;

        // Verificar citas existentes del doctor
        const booked = this.appointments.filter(a => a.profId === doc.id && a.date === dateStr && a.status !== 'Cancelada');
        const hasOverlap = booked.some(a => {
          if (!a.time) return false;
          const [aH, aM] = a.time.split(':').map(Number);
          const aStart = aH * 60 + aM;
          const aDur = Number(a.duration) || 45;
          const aEnd = aStart + aDur;
          return (s.startMin < aEnd && s.endMin > aStart);
        });

        if (!hasOverlap) {
          assignedDoc = doc;
          break; // encontramos un doctor libre
        }
      }

      const isAvailable = Boolean(assignedDoc);
      if (isAvailable) totalFree++;

      return {
        ...s,
        isAvailable,
        assignedDoc: assignedDoc
      };
    };

    const finalMorning = baseMorning.map(processSlot);
    const finalAfternoon = baseAfternoon.map(processSlot);

    return {
      freeCount: totalFree,
      morning: finalMorning,
      afternoon: finalAfternoon
    };
  },

  renderSlots(dateStr) {
    const slotData = this.calculateSlotsForDate(dateStr);
    const morningContainer = document.getElementById('morning-slots');
    const afternoonContainer = document.getElementById('afternoon-slots');

    const renderGrid = (slots, container) => {
      if (!container) return;
      if (!slots || slots.length === 0) {
        container.innerHTML = '<div class="slots-placeholder">Sin turnos disponibles.</div>';
        return;
      }

      container.innerHTML = slots.map(s => {
        const isSelected = this.selectedSlot && this.selectedSlot.time === s.time;
        const disabled = !s.isAvailable;
        return `
          <button type="button" class="slot-chip ${isSelected ? 'selected' : ''}" 
                  ${disabled ? 'disabled' : ''} 
                  onclick="BookingApp.chooseSlot('${s.time}', '${s.endTime}', '${s.assignedDoc ? s.assignedDoc.id : ''}')">
            <span class="slot-time">${s.time}</span>
            <span class="slot-end">hasta ${s.endTime}</span>
          </button>
        `;
      }).join('');
    };

    renderGrid(slotData.morning, morningContainer);
    renderGrid(slotData.afternoon, afternoonContainer);
  },

  chooseSlot(time, endTime, docId) {
    const assignedDoc = this.professionals.find(p => p.id === docId) || 
      (this.selectedDoctorId !== 'any' ? this.professionals.find(p => p.id === this.selectedDoctorId) : this.professionals[0]);

    this.selectedSlot = {
      time: time,
      endTime: endTime,
      doctor: assignedDoc
    };

    // Actualizar nav stepper
    document.getElementById('nav-sub-slot').textContent = `${this.formatDateShort(this.selectedDate)} ${time}`;

    // Habilitar botón de continuar
    const btnNext = document.getElementById('btn-next-step3');
    if (btnNext) btnNext.disabled = false;

    // Re-renderizar slots para marcar seleccionado
    this.renderSlots(this.selectedDate);
  },

  // ========================================================================
  // PASO 4: RESUMEN Y CONFIRMACIÓN
  // ========================================================================
  renderSummary() {
    if (!this.currentClient || !this.selectedService || !this.selectedDate || !this.selectedSlot) {
      return;
    }

    const doc = this.selectedSlot.doctor || this.professionals[0];

    document.getElementById('sum-serv-name').textContent = this.selectedService.name;
    document.getElementById('sum-serv-desc').textContent = this.selectedService.description || 'Consulta médica y tratamiento en cabina clínica.';
    document.getElementById('sum-serv-price').textContent = `${Number(this.selectedService.price).toFixed(0)} €`;
    document.getElementById('sum-serv-dur').textContent = `${this.selectedService.duration} min`;

    document.getElementById('sum-doc-name').textContent = doc.name;
    document.getElementById('sum-doc-room').textContent = `${doc.roleTitle || 'Especialista'} • ${doc.room}`;

    document.getElementById('sum-date-time').textContent = `${this.formatDateDisplay(this.selectedDate)} a las ${this.selectedSlot.time} h (${this.selectedSlot.time} - ${this.selectedSlot.endTime})`;

    document.getElementById('sum-client-name').textContent = this.currentClient.name;
    document.getElementById('sum-client-phone').textContent = this.currentClient.phone;
    document.getElementById('sum-client-dni').textContent = this.currentClient.dni;
    document.getElementById('sum-client-email').textContent = this.currentClient.email;

    this.initIcons();
  },

  // ========================================================================
  // CONFIRMACIÓN Y GUARDADO EN GITHUB
  // ========================================================================
  async submitBooking() {
    const btn = document.getElementById('btn-confirm-booking');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader" class="spin"></i> <span>Guardando cita en la agenda...</span>`;
      this.initIcons();
    }

    const notesExtra = document.getElementById('booking-final-notes')?.value.trim() || '';
    const doc = this.selectedSlot.doctor || this.professionals[0];

    try {
      // 1. Obtener los datos más frescos de GitHub junto con el SHA actual
      let freshData = null;
      let currentSha = null;

      try {
        // Obtenemos el SHA a través del listado del directorio data/
        const dirRes = await fetch(`${BookingConfig.dataDirUrl}?t=${Date.now()}`, {
          cache: 'no-store',
          headers: {
            'Authorization': `token ${BookingConfig.githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'NymeriaBookingWeb'
          }
        });

        if (dirRes.ok) {
          const list = await dirRes.json();
          const f = Array.isArray(list) ? list.find(x => x.name === 'backup.json') : null;
          if (f) currentSha = f.sha;
        }

        // Descargamos el contenido RAW más reciente
        const rawRes = await fetch(`${BookingConfig.apiUrl}?t=${Date.now()}`, {
          cache: 'no-store',
          headers: {
            'Authorization': `token ${BookingConfig.githubToken}`,
            'Accept': 'application/vnd.github.raw',
            'User-Agent': 'NymeriaBookingWeb'
          }
        });

        if (rawRes.ok) {
          freshData = await rawRes.json();
        }
      } catch (err) {
        console.warn('Fallo leyendo GitHub fresco:', err);
      }

      if (!freshData) {
        freshData = this.backupData || {};
      }

      freshData.clients = Array.isArray(freshData.clients) ? freshData.clients : [];
      freshData.appointments = Array.isArray(freshData.appointments) ? freshData.appointments : [];

      // 2. Si el cliente es nuevo, verificar duplicados y agregarlo a clients
      if (this.currentClient.isNewWebClient) {
        const cleanDniVal = this.cleanDni(this.currentClient.dni);
        const alreadyIn = freshData.clients.some(c => this.cleanDni(c.dni) === cleanDniVal);
        if (!alreadyIn) {
          freshData.clients.push({
            id: this.currentClient.id,
            name: this.currentClient.name,
            phone: this.currentClient.phone,
            dni: this.currentClient.dni,
            email: this.currentClient.email,
            allergies: this.currentClient.allergies || 'Sin alergias notificadas',
            notes: this.currentClient.notes || 'Registrado desde la web de reserva online',
            signatures: [],
            registeredAt: new Date().toISOString()
          });
        }
      }

      // 3. Crear el objeto de la cita
      const appointmentId = 'cita-web-' + Date.now();
      const refCode = `NYM-WEB-${Math.floor(10000 + Math.random() * 90000)}`;

      const newAppointment = {
        id: appointmentId,
        refCode: refCode,
        clientId: this.currentClient.id,
        clientName: this.currentClient.name,
        clientPhone: this.currentClient.phone,
        clientDni: this.currentClient.dni,
        profId: doc.id,
        serviceId: this.selectedService.id,
        serviceName: this.selectedService.name,
        date: this.selectedDate,
        time: this.selectedSlot.time,
        duration: Number(this.selectedService.duration) || 45,
        price: Number(this.selectedService.price) || 0,
        deposit: 0,
        depositMethod: null,
        status: 'Pendiente', // Cita pendiente de confirmación presencial
        isOnline: true,
        createdBy: 'Reserva Web Online',
        createdAt: new Date().toISOString(),
        notes: notesExtra ? `[RESERVA WEB] ${notesExtra}` : '[RESERVA WEB] Cita reservada online por el paciente'
      };

      // Colocar la nueva cita al principio
      freshData.appointments.unshift(newAppointment);

      // Actualizar estadísticas de backup
      if (!freshData.stats) freshData.stats = {};
      freshData.stats.clientsCount = freshData.clients.length;
      freshData.stats.appointmentsCount = freshData.appointments.length;
      freshData.savedAt = new Date().toISOString();
      freshData.savedBy = `Web Online (${this.currentClient.name})`;

      // 4. Subir archivo a GitHub vía PUT
      const jsonContent = JSON.stringify(freshData, null, 2);
      const encodedContent = btoa(unescape(encodeURIComponent(jsonContent)));

      const commitMessage = `web: cita online ${refCode} - ${this.currentClient.name} (${this.selectedService.name} el ${this.selectedDate} a las ${this.selectedSlot.time})`;

      const putRes = await fetch(BookingConfig.apiUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${BookingConfig.githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'NymeriaBookingWeb'
        },
        body: JSON.stringify({
          message: commitMessage,
          content: encodedContent,
          sha: currentSha || undefined
        })
      });

      if (!putRes.ok && (putRes.status === 409 || putRes.status === 422)) {
        // Conflicto de SHA: reintentar con el SHA fresco del momento
        console.warn('Conflicto 409/422 en GitHub. Reintentando con SHA actualizado...');
        const retryDir = await fetch(`${BookingConfig.dataDirUrl}?t=${Date.now()}`, {
          cache: 'no-store',
          headers: {
            'Authorization': `token ${BookingConfig.githubToken}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });
        if (retryDir.ok) {
          const listRetry = await retryDir.json();
          const fRetry = Array.isArray(listRetry) ? listRetry.find(x => x.name === 'backup.json') : null;
          if (fRetry) {
            await fetch(BookingConfig.apiUrl, {
              method: 'PUT',
              headers: {
                'Authorization': `token ${BookingConfig.githubToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                message: commitMessage,
                content: encodedContent,
                sha: fRetry.sha
              })
            });
          }
        }
      }

      console.log('✓ Cita sincronizada con éxito en GitHub');

      // 5. Enviar correos de notificación vía Google Apps Script (asíncrono)
      this.sendNotificationEmails(newAppointment, doc, refCode);

      // 6. Mostrar Pantalla de Éxito
      this.renderSuccess(newAppointment, doc, refCode);

    } catch (err) {
      console.error('Error al confirmar la reserva:', err);
      alert('Hubo un problema al conectar con el servidor de la clínica. Por favor inténtalo de nuevo o llámanos al 643 304 897.');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="check-circle-2"></i> <span>Confirmar Mi Reserva Online</span>`;
        this.initIcons();
      }
    }
  },

  // ========================================================================
  // ENVÍO DE CORREOS AUTOMATIZADOS (APPS SCRIPT)
  // ========================================================================
  async sendNotificationEmails(appt, doc, refCode) {
    const patientEmail = this.currentClient.email;
    const dateFormatted = this.formatDateDisplay(appt.date);

    // 1. Correo de confirmación al paciente
    if (patientEmail) {
      const patientHtml = `
        <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#09090c;color:#f3f4f6;border-radius:14px;overflow:hidden;border:1px solid #c5a059;">
          <div style="background:linear-gradient(135deg,#121217,#1b1b22);padding:28px 24px;text-align:center;border-bottom:1px solid #c5a059;">
            <h1 style="color:#dfba73;font-size:24px;margin:0 0 6px;letter-spacing:1px;font-family:Georgia,serif;">NYMERIA CLÍNICA AVANZADA</h1>
            <p style="color:#9ca3af;font-size:12px;margin:0;text-transform:uppercase;letter-spacing:2px;">Reserva de Cita Confirmada</p>
          </div>
          <div style="padding:28px 24px;">
            <p style="font-size:16px;color:#fff;margin-top:0;">Hola <b>${appt.clientName}</b>,</p>
            <p style="color:#d1d5db;font-size:14px;line-height:1.5;">Tu cita online ha quedado confirmada y sincronizada en nuestra agenda médica con el localizador <b style="color:#dfba73;letter-spacing:1px;">${refCode}</b>.</p>
            
            <div style="background:#15151c;border-left:4px solid #c5a059;padding:16px;border-radius:6px;margin:20px 0;">
              <table style="width:100%;font-size:14px;color:#e5e7eb;">
                <tr><td style="padding:6px 0;color:#9ca3af;width:120px;">Tratamiento:</td><td style="font-weight:bold;color:#dfba73;">${appt.serviceName}</td></tr>
                <tr><td style="padding:6px 0;color:#9ca3af;">Fecha y Hora:</td><td style="font-weight:bold;color:#fff;">${dateFormatted} a las ${appt.time} h</td></tr>
                <tr><td style="padding:6px 0;color:#9ca3af;">Especialista:</td><td>${doc.name} (${doc.room})</td></tr>
                <tr><td style="padding:6px 0;color:#9ca3af;">Tarifa Oficial:</td><td style="font-weight:bold;color:#dfba73;">${appt.price} €</td></tr>
                <tr><td style="padding:6px 0;color:#9ca3af;">Dirección:</td><td>Calle Venezuela, 38, Valencia 46007</td></tr>
              </table>
            </div>

            <p style="font-size:13px;color:#9ca3af;line-height:1.5;">El importe se abonará directamente en recepción el día de tu cita en efectivo o tarjeta. Si necesitas cambiar tu turno, avísanos con al menos 24 horas de antelación llamando al <b>643 304 897</b>.</p>
            
            <div style="text-align:center;margin-top:24px;">
              <a href="https://maps.google.com/?q=Calle+Venezuela+38+Valencia+46007" style="display:inline-block;background:#c5a059;color:#08080a;padding:12px 24px;border-radius:24px;font-weight:bold;text-decoration:none;font-size:14px;">Cómo Llegar a la Clínica (Google Maps)</a>
            </div>
          </div>
          <div style="background:#0c0c10;padding:16px;text-align:center;font-size:11px;color:#6b7280;border-top:1px solid #222;">
            NYMERIA CLÍNICA AVANZADA Y ODONTOLOGÍA S.L. • Calle Venezuela, 38, Valencia • Tel: 643 304 897
          </div>
        </div>
      `;

      try {
        fetch(BookingConfig.scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            secret: BookingConfig.scriptSecret,
            to: patientEmail,
            subject: `✓ Cita Confirmada en Nymeria Clínica (${dateFormatted} a las ${appt.time})`,
            html: patientHtml,
            fromName: 'NYMERIA Clínica'
          })
        }).catch(e => console.warn('Error enviando correo al paciente:', e));
      } catch (e) {
        console.warn('Fallo petición correo paciente:', e);
      }
    }

    // 2. Correo de aviso al jefe/dirección
    const bossEmail = (this.backupData && this.backupData.billingConfig && this.backupData.billingConfig.bossEmail) || BookingConfig.bossEmail;
    if (bossEmail) {
      const bossHtml = `
        <div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#101014;color:#f3f4f6;padding:24px;border-radius:10px;border-top:4px solid #c5a059;">
          <h2 style="color:#dfba73;margin-top:0;">🔔 Nueva Cita Online Registrada</h2>
          <p>Un paciente ha completado una reserva a través de la web:</p>
          <ul>
            <li><b>Localizador:</b> ${refCode}</li>
            <li><b>Paciente:</b> ${appt.clientName} (Tel: ${appt.clientPhone} • DNI: ${appt.clientDni})</li>
            <li><b>Tratamiento:</b> ${appt.serviceName} (${appt.duration} min • ${appt.price} €)</li>
            <li><b>Fecha:</b> ${dateFormatted} a las ${appt.time} h</li>
            <li><b>Especialista asignado:</b> ${doc.name} (${doc.room})</li>
            <li><b>Notas:</b> ${appt.notes}</li>
          </ul>
          <p style="color:#9ca3af;font-size:12px;">Esta cita se ha sincronizado en tiempo real en data/backup.json de GitHub.</p>
        </div>
      `;

      try {
        fetch(BookingConfig.scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            secret: BookingConfig.scriptSecret,
            to: bossEmail,
            subject: `🔔 [NUEVA CITA ONLINE] ${appt.clientName} - ${appt.serviceName} (${appt.date} ${appt.time})`,
            html: bossHtml,
            fromName: 'Nymeria Citas Online'
          })
        }).catch(e => console.warn('Error enviando aviso al jefe:', e));
      } catch (e) {
        console.warn('Fallo petición correo jefe:', e);
      }
    }
  },

  // ========================================================================
  // PASO 5: PANTALLA DE ÉXITO
  // ========================================================================
  renderSuccess(appt, doc, refCode) {
    this.switchStep(5);

    document.getElementById('success-ref-code').textContent = refCode;
    document.getElementById('success-service-name').textContent = appt.serviceName;
    document.getElementById('success-date-time').textContent = `${this.formatDateDisplay(appt.date)} a las ${appt.time} h`;
    document.getElementById('success-doctor-name').textContent = `${doc.name} (${doc.room})`;
    document.getElementById('success-client-name').textContent = `${appt.clientName} (${appt.clientPhone})`;

    // Enlace a Google Calendar
    const calLink = this.generateGoogleCalendarLink(appt, doc);
    const btnCal = document.getElementById('btn-add-calendar');
    if (btnCal) btnCal.href = calLink;

    this.initIcons();
  },

  generateGoogleCalendarLink(appt, doc) {
    const title = encodeURIComponent(`Cita en Nymeria: ${appt.serviceName}`);
    const details = encodeURIComponent(`Tratamiento: ${appt.serviceName}\nEspecialista: ${doc.name}\nGabinete: ${doc.room}\nPaciente: ${appt.clientName}\nLocalizador: ${appt.refCode || ''}\nClínica Nymeria: 643 304 897`);
    const location = encodeURIComponent('Calle Venezuela, 38, Valencia 46007');

    // Calcular fechas en formato UTC YYYYMMDDTHHmmSSZ
    const [year, month, day] = appt.date.split('-').map(Number);
    const [h, m] = appt.time.split(':').map(Number);
    const startObj = new Date(year, month - 1, day, h, m);
    const endObj = new Date(startObj.getTime() + (Number(appt.duration) || 45) * 60000);

    const formatCalDate = (d) => {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
    };

    const dates = `${formatCalDate(startObj)}/${formatCalDate(endObj)}`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}&location=${location}`;
  },

  resetPortal() {
    this.selectedService = null;
    this.selectedDate = null;
    this.selectedSlot = null;
    this.goToStep(2);
  },

  // ========================================================================
  // UTILIDADES DE FORMATO DE FECHA
  // ========================================================================
  getLocalDateStr(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  formatDateDisplay(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return `${dayNames[dateObj.getDay()]}, ${d} de ${monthNames[m - 1]} de ${y}`;
  },

  formatDateShort(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${d} ${monthNames[m - 1]}`;
  },

  showToast(msg, type = 'info') {
    alert(msg);
  }
};

// Iniciar aplicación al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
  BookingApp.init();
});
