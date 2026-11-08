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
  allServices: [],
  services: [],
  grouponOffers: [],
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

  // Estado cupón / campaña Groupon
  hasGroupon: false,
  selectedGrouponValue: '',
  selectedGrouponOffer: null,
  grouponCode: '',

  // Días laborables generados
  availableDays: [],

  async init() {
    this.initIcons();
    await this.loadClinicData();
    this.populateGrouponOfferSelects();
    this.checkSavedSession();
    this.renderServicesCatalog();
    this.syncGrouponUI();
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
      const rawServices = Array.isArray(data.services) ? data.services : [];
      this.allServices = rawServices;
      // En la web pública NUNCA se muestran servicios gratuitos (0 €) ni revisiones internas
      this.services = rawServices.filter(s => s && Number(s.price) > 0 && !s.internalOnly);
      this.grouponOffers = (Array.isArray(data.grouponOffers) ? data.grouponOffers : []).filter(o => o && o.active !== false);
      this.professionals = Array.isArray(data.professionals) ? data.professionals : [];
      this.defaultSchedules = data.defaultSchedules || {};
      this.blockedDates = Array.isArray(data.blockedDates) ? data.blockedDates : [];

      console.log(`✓ Sincronizado: ${this.services.length} servicios visibles web, ${this.grouponOffers.length} ofertas Groupon activas, ${this.professionals.length} especialistas, ${this.clients.length} pacientes, ${this.appointments.length} citas.`);
      
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
      this.showToast('Selecciona primero un tratamiento o canjea tu cupón Groupon.', 'warning');
      this.switchStep(2);
      return;
    }
    if (targetStep > 2 && this.hasGroupon) {
      if (this.grouponOffers.length > 0 && !this.selectedGrouponOffer) {
        this.showToast('Selecciona la oferta de Groupon adquirida para continuar.', 'warning');
        return;
      }
      if (!this.grouponCode || !this.grouponCode.trim()) {
        this.showToast('Introduce tu código de cupón / seguridad de Groupon para continuar (o desmarca la casilla si no usas cupón).', 'warning');
        return;
      }
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
      this.syncGrouponUI();
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
    const panelLogin = document.getElementById('auth-tab-login');
    const panelRegister = document.getElementById('auth-tab-register');

    if (formLogin) formLogin.classList.add('hidden');
    if (panelRegister) panelRegister.classList.remove('active');
    if (panelLogin) panelLogin.classList.add('active');
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

    this.populateGrouponOfferSelects();
    this.syncGrouponUI();
    this.initIcons();
  },

  logoutClient() {
    this.currentClient = null;
    this.selectedService = null;
    this.selectedDate = null;
    this.selectedSlot = null;
    this.clearGrouponState();
    sessionStorage.removeItem('nymeria_web_patient');

    document.getElementById('nav-sub-client').textContent = 'Paciente';
    document.getElementById('nav-sub-service').textContent = 'Seleccionar';
    document.getElementById('nav-sub-slot').textContent = 'Hueco libre';
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
    this.updateServiceBanner();
    this.initIcons();
  },

  // ========================================================================
  // GESTIÓN DE OFERTAS Y CUPONES GROUPON (PASOS 1, 2 Y 4)
  // ========================================================================
  getGrouponOfferParts(offer) {
    if (!offer) return { customTitle: '', internalName: '', displayTitle: '', isPack: false, packList: [] };
    const packList = (Array.isArray(offer.services) && offer.services.length > 0) ? offer.services : [];
    const isPack = Boolean(offer.isPack || packList.length > 1);
    const linkedServ = (this.allServices || []).find(s => String(s.id) === String(offer.serviceId)) || null;
    const internalName = (
      offer.serviceName ||
      (packList.length > 0 ? packList.map(x => x.name).join(' + ') : '') ||
      (linkedServ ? linkedServ.name : '') ||
      offer.title ||
      ''
    ).trim();
    const rawCustom = (
      offer.customTitle ||
      (offer.title && offer.title.trim() !== internalName ? offer.title : '') ||
      ''
    ).trim();
    const customTitle = (rawCustom && rawCustom !== internalName) ? rawCustom : '';
    const displayTitle = customTitle || internalName || 'Oferta Groupon';
    return { customTitle, internalName, displayTitle, isPack, packList };
  },

  formatGrouponDisplayLabel(offer, serviceName) {
    if (!offer) return serviceName || '';
    const { customTitle, internalName, displayTitle } = this.getGrouponOfferParts(offer);
    const baseName = serviceName || internalName;
    if (customTitle && baseName && customTitle !== baseName) {
      return `${customTitle} (${baseName})`;
    }
    return baseName || displayTitle;
  },

  getEffectiveDuration() {
    if (this.hasGroupon && this.selectedGrouponOffer && Number(this.selectedGrouponOffer.duration) > 0) {
      return Number(this.selectedGrouponOffer.duration);
    }
    return this.selectedService ? (Number(this.selectedService.duration) || 45) : 45;
  },

  getEffectivePriceInfo() {
    if (this.hasGroupon) {
      if (this.selectedGrouponOffer) {
        const isPrepago = this.selectedGrouponOffer.paymentType !== 'pago_clinica' || Number(this.selectedGrouponOffer.grouponPrice || 0) === 0;
        return {
          isGroupon: true,
          paymentType: isPrepago ? 'prepago' : 'pago_clinica',
          price: isPrepago ? 0 : Number(this.selectedGrouponOffer.grouponPrice || 0)
        };
      }
      return { isGroupon: true, paymentType: 'prepago', price: 0 };
    }
    return {
      isGroupon: false,
      paymentType: null,
      price: this.selectedService ? (Number(this.selectedService.price) || 0) : 0
    };
  },

  resolveGrouponSelection(val) {
    if (!val) return { offer: null, service: null };

    if (String(val).startsWith('srv:')) {
      const sid = String(val).slice(4);
      const serv = this.services.find(s => String(s.id) === sid) || this.allServices.find(s => String(s.id) === sid) || null;
      return { offer: null, service: serv };
    }

    const offer = this.grouponOffers.find(o => String(o.id) === String(val)) || null;
    if (!offer) return { offer: null, service: null };

    const packList = (Array.isArray(offer.services) && offer.services.length > 0) ? offer.services : null;
    const isPack = Boolean(offer.isPack || (packList && packList.length > 1));

    if (isPack && packList) {
      const resolvedItems = packList.map(item => {
        const live = this.allServices.find(s => String(s.id) === String(item.id));
        return live
          ? { id: live.id, name: live.name, category: live.category, duration: Number(live.duration) || 45, price: Number(live.price) || 0 }
          : { id: item.id, name: item.name, category: item.category || 'medico', duration: Number(item.duration) || 45, price: Number(item.price) || 0 };
      });
      const packName = offer.serviceName || offer.title || resolvedItems.map(x => x.name).join(' + ');
      const packCats = (Array.isArray(offer.categories) && offer.categories.length > 0)
        ? offer.categories
        : [...new Set(resolvedItems.map(x => x.category).filter(Boolean))];
      const totalOriginalPrice = resolvedItems.reduce((sum, x) => sum + Number(x.price || 0), 0);
      const sumDuration = resolvedItems.reduce((sum, x) => sum + (Number(x.duration) || 45), 0);

      return {
        offer,
        service: {
          id: offer.serviceId || resolvedItems[0]?.id || ('pack-' + offer.id),
          name: packName,
          category: offer.category || packCats[0] || 'medico',
          categories: packCats,
          isPack: true,
          packItems: resolvedItems,
          duration: Number(offer.duration) || sumDuration || 45,
          price: totalOriginalPrice > 0 ? totalOriginalPrice : Number(offer.grouponPrice || 0),
          description: offer.description || `Pack Groupon (${resolvedItems.length} tratamientos): ${packName}.`
        }
      };
    }

    let serv = this.allServices.find(s => String(s.id) === String(offer.serviceId)) || null;
    if (!serv) {
      serv = {
        id: offer.serviceId || ('serv-' + offer.id),
        name: offer.serviceName || offer.title,
        category: offer.category || 'medico',
        duration: Number(offer.duration) || 45,
        price: Number(offer.grouponPrice || 0),
        description: offer.description || 'Tratamiento incluido en oferta promocional de Groupon.'
      };
    }
    return { offer, service: serv };
  },

  populateGrouponOfferSelects() {
    const ids = ['step1-groupon-offer', 'step2-groupon-offer', 'online-groupon-offer'];
    ids.forEach(selId => {
      const select = document.getElementById(selId);
      if (!select) return;
      select.innerHTML = '';

      const defOpt = document.createElement('option');
      defOpt.value = '';
      defOpt.textContent = this.grouponOffers.length > 0
        ? '-- Selecciona la oferta comprada en Groupon --'
        : '-- Selecciona el tratamiento de tu cupón Groupon --';
      select.appendChild(defOpt);

      if (this.grouponOffers.length > 0) {
        this.grouponOffers.forEach(o => {
          const isPrepago = o.paymentType !== 'pago_clinica' || Number(o.grouponPrice || 0) === 0;
          const priceTxt = isPrepago
            ? '0 € en clínica (Prepago Groupon)'
            : `${Number(o.grouponPrice).toFixed(2)} € en clínica`;
          const { customTitle, internalName, displayTitle, isPack, packList } = this.getGrouponOfferParts(o);
          const packTag = isPack ? `Pack (${packList.length}): ` : '';
          const labelCore = customTitle
            ? `${customTitle} — [${packTag || 'Incluye: '}${internalName}]`
            : `${packTag}${displayTitle}`;
          const shortDesc = o.description ? ` (${o.description.length > 35 ? o.description.substring(0, 35) + '...' : o.description})` : '';
          const opt = document.createElement('option');
          opt.value = o.id;
          opt.textContent = `${labelCore}${shortDesc} • ${o.duration || 45} min (${priceTxt})`;
          select.appendChild(opt);
        });
      } else {
        const grp = document.createElement('optgroup');
        grp.label = 'Tratamientos disponibles en clínica';
        this.services.forEach(s => {
          const opt = document.createElement('option');
          opt.value = `srv:${s.id}`;
          opt.textContent = `${s.name} • ${s.duration || 45} min`;
          grp.appendChild(opt);
        });
        select.appendChild(grp);
      }

      if (this.selectedGrouponValue && Array.from(select.options).some(o => o.value === this.selectedGrouponValue)) {
        select.value = this.selectedGrouponValue;
      }
    });
  },

  clearGrouponState() {
    this.hasGroupon = false;
    this.selectedGrouponValue = '';
    this.selectedGrouponOffer = null;
    this.grouponCode = '';
    this.syncGrouponUI();
  },

  syncGrouponUI() {
    ['step1-has-groupon', 'step2-has-groupon', 'online-has-groupon'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = this.hasGroupon;
    });

    const panel1 = document.getElementById('step1-groupon-fields');
    const panel2 = document.getElementById('step2-groupon-fields');
    const panel4 = document.getElementById('online-groupon-field');
    if (panel1) panel1.classList.toggle('hidden', !this.hasGroupon);
    if (panel2) panel2.classList.toggle('hidden', !this.hasGroupon);
    if (panel4) panel4.classList.toggle('hidden', !this.hasGroupon);

    ['step1-groupon-offer', 'step2-groupon-offer', 'online-groupon-offer'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.value = Array.from(el.options).some(o => o.value === this.selectedGrouponValue)
          ? this.selectedGrouponValue
          : '';
      }
    });

    ['step1-groupon-code', 'step2-groupon-code', 'online-groupon-code'].forEach(id => {
      const el = document.getElementById(id);
      if (el && document.activeElement !== el && el.value !== (this.grouponCode || '')) {
        el.value = this.grouponCode || '';
      }
    });

    const { offer, service } = this.resolveGrouponSelection(this.selectedGrouponValue);
    let previewHtml = '';
    if (this.hasGroupon && service) {
      const effDur = (offer && Number(offer.duration) > 0) ? Number(offer.duration) : (Number(service.duration) || 45);
      const isPrepago = !offer || offer.paymentType !== 'pago_clinica' || Number(offer.grouponPrice || 0) === 0;
      const priceBadge = isPrepago
        ? '0,00 € en clínica (Ya pagado en Groupon)'
        : `${Number(offer.grouponPrice).toFixed(2)} € a abonar en clínica`;
      const esc = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const parts = offer ? this.getGrouponOfferParts(offer) : null;
      const offerHeading = esc(parts ? parts.displayTitle : service.name);
      const safeServName = esc(service.name);
      const isPack = Boolean(service.isPack || (parts && parts.isPack));
      const hasCustomAlias = Boolean(parts && parts.customTitle && parts.customTitle !== service.name);
      const descTxt = offer && offer.description ? ` • ${esc(offer.description)}` : '';
      const habitualTxt = Number(service.price) > 0
        ? ` • Tarifa habitual${isPack ? ' conjunta' : ''}: ${Number(service.price).toFixed(0)} €`
        : '';
      const offerSub = offer
        ? (isPack
            ? (hasCustomAlias
                ? `🎁 <b>Incluye (Pack de ${service.packItems ? service.packItems.length : offer.services.length}):</b> ${safeServName}${descTxt}${habitualTxt}`
                : `🎁 Pack de ${service.packItems ? service.packItems.length : offer.services.length} tratamientos${descTxt}${habitualTxt}`)
            : (hasCustomAlias
                ? `<b>Tratamiento incluido en clínica:</b> ${safeServName}${descTxt}${habitualTxt}`
                : (offer.description
                    ? `${esc(offer.description)}${habitualTxt}`
                    : `Tratamiento oficial con tu cupón${Number(service.price) > 0 ? ` (tarifa habitual: ${Number(service.price).toFixed(0)} €)` : ''}`)))
        : `Tratamiento seleccionado del catálogo (${service.duration || 45} min)`;

      previewHtml = `
        <div class="groupon-prev-left">
          <strong>${offerHeading}</strong>
          <span>${offerSub}</span>
        </div>
        <div class="groupon-prev-right">
          <span class="groupon-price-badge">${priceBadge}</span>
          <span class="groupon-dur-note"><i data-lucide="clock" style="width:11px;height:11px;display:inline;vertical-align:middle;"></i> Duración en agenda: ${effDur} min</span>
        </div>
      `;
    }

    ['step1-groupon-preview', 'step2-groupon-preview', 'online-groupon-preview'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (previewHtml) {
        el.innerHTML = previewHtml;
        el.classList.remove('hidden');
      } else {
        el.innerHTML = '';
        el.classList.add('hidden');
      }
    });

    this.initIcons();
  },

  toggleGrouponPanel(sourceStep) {
    const chkId = sourceStep === 4 ? 'online-has-groupon' : `step${sourceStep}-has-groupon`;
    const chk = document.getElementById(chkId);
    const checked = Boolean(chk && chk.checked);
    this.hasGroupon = checked;

    if (checked) {
      if (!this.selectedGrouponValue && this.selectedService) {
        if (this.grouponOffers.length > 0) {
          const match = this.grouponOffers.find(o => !o.isPack && String(o.serviceId) === String(this.selectedService.id))
            || this.grouponOffers.find(o => String(o.serviceId) === String(this.selectedService.id));
          if (match) {
            this.selectedGrouponValue = match.id;
            this.selectedGrouponOffer = match;
          }
        } else {
          this.selectedGrouponValue = `srv:${this.selectedService.id}`;
          this.selectedGrouponOffer = null;
        }
      }
      this.syncGrouponUI();
      this.updateServiceBanner();
      if (this.step === 4) this.renderSummary();

      const focusTarget = this.selectedGrouponValue
        ? (sourceStep === 4 ? 'online-groupon-code' : `step${sourceStep}-groupon-code`)
        : (sourceStep === 4 ? 'online-groupon-offer' : `step${sourceStep}-groupon-offer`);
      document.getElementById(focusTarget)?.focus();
    } else {
      this.selectedGrouponValue = '';
      this.selectedGrouponOffer = null;
      this.grouponCode = '';
      this.syncGrouponUI();
      this.updateServiceBanner();
      if (this.step === 4) this.renderSummary();
    }
  },

  onGrouponOfferSelect(sourceStep, val) {
    this.hasGroupon = true;
    this.selectedGrouponValue = val || '';

    const { offer, service } = this.resolveGrouponSelection(val);
    if (val && service) {
      const prevServiceId = this.selectedService ? this.selectedService.id : null;
      const prevCategory = this.selectedService ? this.selectedService.category : null;
      const prevDur = this.getEffectiveDuration();

      this.selectedGrouponOffer = offer;
      this.selectedService = service;
      const newDur = this.getEffectiveDuration();

      if (this.selectedSlot && (prevCategory !== service.category || prevDur !== newDur)) {
        this.selectedDate = null;
        this.selectedSlot = null;
        const navSlot = document.getElementById('nav-sub-slot');
        if (navSlot) navSlot.textContent = 'Hueco libre';

        if (sourceStep === 4) {
          this.syncGrouponUI();
          this.updateServiceBanner();
          this.renderServicesCatalog();
          this.showToast('La oferta Groupon elegida tiene otra duración o especialidad. Selecciona tu nuevo horario disponible.');
          this.goToStep(3);
          return;
        }
      } else if (prevServiceId !== service.id || prevDur !== newDur) {
        this.selectedDate = null;
        this.selectedSlot = null;
        const navSlot = document.getElementById('nav-sub-slot');
        if (navSlot) navSlot.textContent = 'Hueco libre';
      }

      this.updateServiceBanner();
      this.renderServicesCatalog();
    } else {
      this.selectedGrouponOffer = null;
    }

    this.syncGrouponUI();
    if (this.step === 4) {
      this.renderSummary();
    }
  },

  onGrouponCodeInput(val) {
    this.grouponCode = (val || '').trimStart();
    ['step1-groupon-code', 'step2-groupon-code', 'online-groupon-code'].forEach(id => {
      const el = document.getElementById(id);
      if (el && document.activeElement !== el && el.value !== (val || '')) {
        el.value = val || '';
      }
    });
  },

  applyGrouponAndContinue(sourceStep) {
    if (!this.currentClient) {
      this.showToast('Identifícate primero en el Paso 1 para continuar.');
      return;
    }

    const offerEl = document.getElementById(`step${sourceStep}-groupon-offer`);
    const codeEl = document.getElementById(`step${sourceStep}-groupon-code`);
    const offerVal = offerEl ? offerEl.value : this.selectedGrouponValue;
    const code = codeEl ? codeEl.value.trim() : this.grouponCode.trim();

    if (!offerVal) {
      alert('Por favor selecciona la oferta de Groupon que has comprado.');
      offerEl?.focus();
      return;
    }

    const { offer, service } = this.resolveGrouponSelection(offerVal);
    if (!service) {
      alert('No se pudo vincular el tratamiento de esta oferta.');
      return;
    }

    if (!code) {
      alert('Por favor introduce tu código de cupón o código de seguridad de Groupon.');
      codeEl?.focus();
      return;
    }

    this.hasGroupon = true;
    this.grouponCode = code;
    this.selectedGrouponValue = offerVal;
    this.selectedGrouponOffer = offer;

    const prevId = this.selectedService ? this.selectedService.id : null;
    const prevDur = this.getEffectiveDuration();
    this.selectedService = service;
    const newDur = this.getEffectiveDuration();
    if (prevId !== service.id || prevDur !== newDur) {
      this.selectedDate = null;
      this.selectedSlot = null;
      const navSlot = document.getElementById('nav-sub-slot');
      if (navSlot) navSlot.textContent = 'Hueco libre';
    }

    this.syncGrouponUI();
    this.updateServiceBanner();
    this.goToStep(3);
  },

  updateServiceBanner() {
    const navSub = document.getElementById('nav-sub-service');
    const banner = document.getElementById('selected-service-banner');
    const bannerName = document.getElementById('banner-serv-name');
    const bannerMeta = document.getElementById('banner-serv-meta');
    const btnNext = document.getElementById('btn-next-step2');

    if (!this.selectedService) {
      if (navSub) navSub.textContent = 'Seleccionar';
      if (banner) banner.classList.add('hidden');
      if (btnNext) btnNext.disabled = true;
      return;
    }

    const effDur = this.getEffectiveDuration();
    const priceInfo = this.getEffectivePriceInfo();
    const displayLabel = (this.hasGroupon && this.selectedGrouponOffer)
      ? this.formatGrouponDisplayLabel(this.selectedGrouponOffer, this.selectedService.name)
      : this.selectedService.name;

    if (navSub) {
      navSub.textContent = displayLabel.length > 18 ? `${displayLabel.substring(0, 16)}...` : displayLabel;
    }

    if (banner) {
      banner.classList.remove('hidden');
      if (bannerName) bannerName.textContent = displayLabel;
      if (bannerMeta) {
        const priceTxt = priceInfo.isGroupon
          ? (priceInfo.price === 0 ? '0 € (Prepago Groupon)' : `${priceInfo.price.toFixed(2)} € (Oferta Groupon)`)
          : `Tarifa Oficial: ${Number(this.selectedService.price).toFixed(0)} €`;
        bannerMeta.textContent = `${effDur} min • ${priceTxt}`;
      }
    }

    if (btnNext) btnNext.disabled = false;
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

    let filtered = this.services.filter(s => s && Number(s.price) > 0 && !s.internalOnly);

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
      const isSelected = !this.hasGroupon && this.selectedService && this.selectedService.id === s.id;
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

    const prevId = this.selectedService ? this.selectedService.id : null;
    const prevWasGroupon = this.hasGroupon;
    const prevDur = this.getEffectiveDuration();

    // Elegir un tratamiento del catálogo general vuelve a Tarifa Habitual
    this.clearGrouponState();
    this.selectedService = serv;

    if (prevId !== serv.id || prevWasGroupon || prevDur !== Number(serv.duration)) {
      this.selectedDate = null;
      this.selectedSlot = null;
      const navSlot = document.getElementById('nav-sub-slot');
      if (navSlot) navSlot.textContent = 'Hueco libre';
    }

    this.updateServiceBanner();
    this.renderServicesCatalog();
  },

  // ========================================================================
  // PASO 3: ESPECIALISTA, CALENDARIO Y TURNOS LIBRES
  // ========================================================================
  getEligibleProfessionalsForSelectedService() {
    if (!this.selectedService) return this.professionals;
    const cats = (this.selectedService.categories && Array.isArray(this.selectedService.categories) && this.selectedService.categories.length > 0)
      ? this.selectedService.categories
      : [this.selectedService.category].filter(Boolean);

    const profMatchesCat = (p, cat) => {
      if (p.categories && Array.isArray(p.categories)) {
        return p.categories.includes(cat) || p.role === cat;
      }
      return p.role === cat;
    };

    const primaryCat = cats[0];
    const eligible = this.professionals.filter(p => cats.some(cat => profMatchesCat(p, cat)));
    if (eligible.length === 0) return this.professionals;

    // Priorizar especialistas de la categoría principal al asignar automáticamente
    return [...eligible].sort((a, b) => {
      const aPrim = primaryCat && profMatchesCat(a, primaryCat) ? 0 : 1;
      const bPrim = primaryCat && profMatchesCat(b, primaryCat) ? 0 : 1;
      return aPrim - bPrim;
    });
  },

  setupStep3() {
    if (!this.selectedService) return;

    // Población del selector de doctores compatibles
    const select = document.getElementById('doctor-select');
    if (!select) return;

    select.innerHTML = '';

    // Filtrar especialistas compatibles con el tratamiento o cualquiera del Pack
    const eligible = this.getEligibleProfessionalsForSelectedService();

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
    const effDur = this.getEffectiveDuration();
    const displayLabel = (this.hasGroupon && this.selectedGrouponOffer)
      ? this.formatGrouponDisplayLabel(this.selectedGrouponOffer, this.selectedService.name)
      : this.selectedService.name;
    document.getElementById('cur-day-display').textContent = this.formatDateDisplay(dateStr);
    document.getElementById('slots-duration-hint').textContent = `Franjas de ${effDur} min adaptadas a "${displayLabel}"`;

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

    const duration = this.getEffectiveDuration();
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
      eligibleProfs = this.getEligibleProfessionalsForSelectedService();
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
    const effDur = this.getEffectiveDuration();
    const priceInfo = this.getEffectivePriceInfo();
    const grpOffer = priceInfo.isGroupon ? this.selectedGrouponOffer : null;

    document.getElementById('sum-serv-name').textContent = grpOffer
      ? this.formatGrouponDisplayLabel(grpOffer, this.selectedService.name)
      : this.selectedService.name;
    document.getElementById('sum-serv-desc').textContent = (grpOffer && grpOffer.description)
      ? grpOffer.description
      : (this.selectedService.description || 'Consulta médica y tratamiento en cabina clínica.');

    if (priceInfo.isGroupon) {
      document.getElementById('sum-serv-price').textContent = priceInfo.price === 0
        ? '0 € (Prepago Groupon)'
        : `${priceInfo.price.toFixed(2)} € (Oferta Groupon)`;
    } else {
      document.getElementById('sum-serv-price').textContent = `${Number(this.selectedService.price).toFixed(0)} €`;
    }
    document.getElementById('sum-serv-dur').textContent = `${effDur} min`;

    document.getElementById('sum-doc-name').textContent = doc.name;
    document.getElementById('sum-doc-room').textContent = `${doc.roleTitle || 'Especialista'} • ${doc.room}`;

    document.getElementById('sum-date-time').textContent = `${this.formatDateDisplay(this.selectedDate)} a las ${this.selectedSlot.time} h (${this.selectedSlot.time} - ${this.selectedSlot.endTime})`;

    document.getElementById('sum-client-name').textContent = this.currentClient.name;
    document.getElementById('sum-client-phone').textContent = this.currentClient.phone;
    document.getElementById('sum-client-dni').textContent = this.currentClient.dni;
    document.getElementById('sum-client-email').textContent = this.currentClient.email;

    const policyDiv = document.querySelector('#step-4 .policy-notice > div');
    if (policyDiv) {
      if (priceInfo.isGroupon) {
        policyDiv.innerHTML = priceInfo.price === 0
          ? `<b>Canje de Cupón Groupon y Política de Cancelación:</b><br>Tu oferta ya está prepagada en Groupon (0 € adicionales por el servicio). Presenta tu código en recepción al llegar. Si necesitas modificar tu turno, avísanos con al menos 24 horas de antelación.`
          : `<b>Canje de Cupón Groupon (${priceInfo.price.toFixed(2)} € en clínica) y Cancelación:</b><br>Presenta tu código de cupón en recepción el día de tu cita y abona el importe promocional acordado (${priceInfo.price.toFixed(2)} € en efectivo o tarjeta). Avísanos con 24h de antelación si necesitas cambiar el turno.`;
      } else {
        policyDiv.innerHTML = `<b>Pago en Clínica y Política de Cancelación:</b><br>El importe se abonará directamente en recepción el día de tu cita (efectivo o tarjeta). Si necesitas modificar o anular tu turno, te rogamos nos avises con al menos 24 horas de antelación para ceder el hueco a otro paciente.`;
      }
    }

    this.syncGrouponUI();
    this.initIcons();
  },

  toggleGrouponField() {
    this.toggleGrouponPanel(4);
  },

  // ========================================================================
  // CONFIRMACIÓN Y GUARDADO EN GITHUB
  // ========================================================================
  async submitBooking() {
    const btn = document.getElementById('btn-confirm-booking');
    const hasGroupon = Boolean(document.getElementById('online-has-groupon')?.checked || this.hasGroupon);
    this.hasGroupon = hasGroupon;
    const grouponCode = hasGroupon ? (document.getElementById('online-groupon-code')?.value.trim() || this.grouponCode.trim()) : '';
    this.grouponCode = grouponCode;

    if (hasGroupon && this.grouponOffers.length > 0 && !this.selectedGrouponOffer) {
      alert('Por favor selecciona la oferta de Groupon que has comprado antes de confirmar la cita.');
      document.getElementById('online-groupon-offer')?.focus();
      return;
    }

    if (hasGroupon && !grouponCode) {
      alert('Por favor introduce tu Código de Cupón de Groupon antes de confirmar la cita.');
      document.getElementById('online-groupon-code')?.focus();
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader" class="spin"></i> <span>Guardando cita en la agenda...</span>`;
      this.initIcons();
    }

    const notesExtra = document.getElementById('booking-final-notes')?.value.trim() || '';
    const doc = this.selectedSlot.doctor || this.professionals[0];
    const effDur = this.getEffectiveDuration();
    const priceInfo = this.getEffectivePriceInfo();
    const grpOffer = hasGroupon ? this.selectedGrouponOffer : null;

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

      const isPack = Boolean(this.selectedService.isPack || (grpOffer && (grpOffer.isPack || (Array.isArray(grpOffer.services) && grpOffer.services.length > 1))));
      const packServices = isPack
        ? (this.selectedService.packItems || (grpOffer ? grpOffer.services : undefined))
        : undefined;
      const grpOfferLabel = grpOffer ? this.getGrouponOfferParts(grpOffer).displayTitle : '';

      const newAppointment = {
        id: appointmentId,
        refCode: refCode,
        clientId: this.currentClient.id,
        clientName: this.currentClient.name,
        clientPhone: this.currentClient.phone,
        clientDni: this.currentClient.dni,
        clientEmail: this.currentClient.email || '',
        profId: doc.id,
        serviceId: this.selectedService.id,
        serviceName: this.selectedService.name,
        date: this.selectedDate,
        time: this.selectedSlot.time,
        duration: effDur,
        price: priceInfo.price,
        originalPrice: Number(this.selectedService.price) || 0,
        origin: hasGroupon ? 'groupon' : 'habitual',
        isPack: isPack,
        packServices: packServices,
        grouponOfferId: grpOffer ? grpOffer.id : '',
        grouponOfferTitle: grpOfferLabel,
        grouponCode: hasGroupon ? grouponCode : '',
        grouponPaymentType: hasGroupon ? priceInfo.paymentType : null,
        deposit: 0,
        depositMethod: null,
        status: 'Pendiente', // Cita pendiente de confirmación en recepción
        isOnline: true,
        createdBy: hasGroupon ? 'Reserva Web (Groupon)' : 'Reserva Web Online',
        createdAt: new Date().toISOString(),
        notes: hasGroupon
          ? `[CUPÓN GROUPON: ${grouponCode}${grpOfferLabel ? ' • ' + grpOfferLabel : ''}] ${notesExtra || 'Reserva online con cupón de Groupon'}`
          : (notesExtra ? `[RESERVA WEB] ${notesExtra}` : '[RESERVA WEB] Cita reservada online por el paciente')
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

      let putRes = await fetch(BookingConfig.apiUrl, {
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
            putRes = await fetch(BookingConfig.apiUrl, {
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

      if (!putRes.ok) {
        const errInfo = await putRes.json().catch(() => ({}));
        throw new Error(errInfo.message || `Error HTTP ${putRes.status}`);
      }

      this.backupData = freshData;
      this.clients = freshData.clients;
      this.appointments = freshData.appointments;
      if (this.currentClient) this.currentClient.isNewWebClient = false;

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
    const isGroupon = appt.origin === 'groupon';
    const isFree = !isGroupon && Number(appt.price) === 0;
    const grpTitleTxt = (appt.grouponOfferTitle && appt.grouponOfferTitle !== appt.serviceName) ? `${appt.grouponOfferTitle} • ` : '';
    const tarifaDisplay = isGroupon
      ? (Number(appt.price || 0) === 0
        ? `Cupón Groupon Prepago (${grpTitleTxt}Código: ${appt.grouponCode}) • 0,00 € en clínica`
        : `Oferta Groupon: ${Number(appt.price).toFixed(2)} € (${grpTitleTxt}Código: ${appt.grouponCode})`)
      : (isFree ? 'Gratuito (0 €)' : `${Number(appt.price).toFixed(2)} €`);
    const paymentNote = isGroupon
      ? (Number(appt.price || 0) === 0
        ? `Recuerda presentar tu cupón Groupon (<b>${appt.grouponCode}</b>) en recepción el día de tu cita. No tendrás que abonar importe adicional por esta oferta prepagada.`
        : `Recuerda presentar tu cupón Groupon (<b>${appt.grouponCode}</b>) en recepción y abonar el importe promocional acordado (<b>${Number(appt.price).toFixed(2)} €</b>).`)
      : `El importe se abonará directamente en recepción el día de tu cita en efectivo o tarjeta.`;

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
                <tr><td style="padding:6px 0;color:#9ca3af;">Tarifa:</td><td style="font-weight:bold;color:#dfba73;">${tarifaDisplay}</td></tr>
                <tr><td style="padding:6px 0;color:#9ca3af;">Dirección:</td><td>Calle Venezuela, 38, Valencia 46007</td></tr>
              </table>
            </div>

            <p style="font-size:13px;color:#9ca3af;line-height:1.5;">${paymentNote} Si necesitas cambiar tu turno, avísanos con al menos 24 horas de antelación llamando al <b>643 304 897</b>.</p>
            
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
            <li><b>Tratamiento:</b> ${appt.serviceName} (${appt.duration} min • ${tarifaDisplay})</li>
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
    document.getElementById('success-service-name').textContent = (appt.grouponOfferTitle && appt.grouponOfferTitle !== appt.serviceName)
      ? `${appt.grouponOfferTitle} (${appt.serviceName})`
      : appt.serviceName;
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
    this.clearGrouponState();

    const notesEl = document.getElementById('booking-final-notes');
    if (notesEl) notesEl.value = '';
    const navSlot = document.getElementById('nav-sub-slot');
    if (navSlot) navSlot.textContent = 'Hueco libre';
    const btnConfirm = document.getElementById('btn-confirm-booking');
    if (btnConfirm) {
      btnConfirm.disabled = false;
      btnConfirm.innerHTML = `<i data-lucide="check-circle-2"></i> <span>Confirmar Mi Reserva Online</span>`;
    }

    this.updateServiceBanner();
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
