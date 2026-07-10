import type { ProjectConfig } from "@domain/ProjectConfig.ts";
import type { App } from "@core/app.ts";

const MENUS = ["Fichier", "Édition", "Composition", "Objet", "Scène", "Affichage"] as const;

/** Barre d'application : wordmark LED + menus interactifs + nom du projet éditable. */
export class MenuBar {
  readonly element: HTMLElement;
  private _app: App | null = null;
  private _projectNameEl: HTMLElement | null = null;

  constructor(config: ProjectConfig) {
    this.element = document.createElement("div");
    this.element.className = "menu-bar";
    this.element.append(
      this._wordmark(),
      this._menus(),
      spacer("menu-bar__spacer"),
      this._project(config.name)
    );
  }

  setApp(app: App): void {
    this._app = app;
  }

  setProjectName(name: string): void {
    if (this._projectNameEl) {
      this._projectNameEl.textContent = name;
    }
  }

  private _wordmark(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "wordmark";

    const dots = document.createElement("div");
    dots.className = "wordmark__dots";
    for (let i = 0; i < 4; i++) {
      const cell = document.createElement("i");
      cell.className = i === 0 || i === 3 ? "wordmark__cell wordmark__cell--on" : "wordmark__cell";
      dots.appendChild(cell);
    }

    const text = document.createElement("span");
    text.className = "wordmark__text";
    text.textContent = "LED";

    wrap.append(dots, text);
    return wrap;
  }

  private _menus(): HTMLElement {
    const nav = document.createElement("nav");
    nav.className = "menu-bar__menus";

    for (const label of MENUS) {
      const menuWrap = document.createElement("div");
      menuWrap.className = "menu-item";

      const trigger = document.createElement("span");
      trigger.className = "menu-item__trigger";
      trigger.textContent = label;
      menuWrap.appendChild(trigger);

      if (label === "Fichier") {
        const dropdown = this._createFileDropdown();
        menuWrap.appendChild(dropdown);
        this._setupDropdownEvents(menuWrap, trigger);
      } else if (label === "Édition") {
        const dropdown = this._createEditDropdown();
        menuWrap.appendChild(dropdown);
        this._setupDropdownEvents(menuWrap, trigger);
      }

      nav.appendChild(menuWrap);
    }
    return nav;
  }

  private _setupDropdownEvents(menuWrap: HTMLElement, trigger: HTMLElement): void {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const active = menuWrap.classList.contains("menu-item--active");
      
      // Fermer tous les menus
      const activeMenus = document.querySelectorAll(".menu-item--active");
      for (const el of activeMenus) {
        el.classList.remove("menu-item--active");
      }

      if (!active) {
        menuWrap.classList.add("menu-item--active");
      }
    });

    // Support du survol si un menu est déjà actif (comportement pro standard)
    trigger.addEventListener("mouseenter", () => {
      const activeMenus = document.querySelectorAll(".menu-item--active");
      if (activeMenus.length > 0) {
        for (const el of activeMenus) {
          el.classList.remove("menu-item--active");
        }
        menuWrap.classList.add("menu-item--active");
      }
    });

    document.addEventListener("click", () => {
      menuWrap.classList.remove("menu-item--active");
    });
  }

  private _createFileDropdown(): HTMLElement {
    const dropdown = document.createElement("div");
    dropdown.className = "menu-item__dropdown";

    const loadItem = document.createElement("div");
    loadItem.className = "menu-dropdown__item";
    loadItem.textContent = "Charger Projet...";
    loadItem.addEventListener("click", () => {
      this._app?.loadProject();
    });

    const saveItem = document.createElement("div");
    saveItem.className = "menu-dropdown__item";
    saveItem.textContent = "Sauvegarder Projet";
    saveItem.addEventListener("click", () => {
      this._app?.saveProject();
    });

    dropdown.append(loadItem, saveItem);
    return dropdown;
  }

  private _createEditDropdown(): HTMLElement {
    const dropdown = document.createElement("div");
    dropdown.className = "menu-item__dropdown";

    const ehubItem = document.createElement("div");
    ehubItem.className = "menu-dropdown__item";
    ehubItem.textContent = "Réseau eHuB...";
    ehubItem.addEventListener("click", () => {
      this._openEhubModal();
    });

    const ctrlItem = document.createElement("div");
    ctrlItem.className = "menu-dropdown__item";
    ctrlItem.textContent = "Contrôleurs Physiques...";
    ctrlItem.addEventListener("click", () => {
      this._openControllersModal();
    });

    dropdown.append(ehubItem, ctrlItem);
    return dropdown;
  }

  private _openEhubModal(): void {
    if (!this._app) return;
    const config = this._app.context.project.config;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const content = document.createElement("div");
    content.className = "modal-content";

    // Header
    const header = document.createElement("div");
    header.className = "modal-header";
    const title = document.createElement("span");
    title.className = "modal-title";
    title.textContent = "Configuration Réseau eHuB";
    const closeBtn = document.createElement("button");
    closeBtn.className = "modal-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", () => overlay.remove());
    header.append(title, closeBtn);

    // Body
    const body = document.createElement("div");
    body.className = "modal-body";

    // IP Host
    const ipGroup = document.createElement("div");
    ipGroup.className = "form-group";
    const ipLabel = document.createElement("label");
    ipLabel.className = "form-label";
    ipLabel.textContent = "Adresse IP (routeur Go)";
    const ipInput = document.createElement("input");
    ipInput.className = "form-input";
    ipInput.type = "text";
    ipInput.value = config.ehub.host;
    ipGroup.append(ipLabel, ipInput);

    // Port UDP
    const portGroup = document.createElement("div");
    portGroup.className = "form-group";
    const portLabel = document.createElement("label");
    portLabel.className = "form-label";
    portLabel.textContent = "Port UDP";
    const portInput = document.createElement("input");
    portInput.className = "form-input";
    portInput.type = "number";
    portInput.value = String(config.ehub.port);
    portGroup.append(portLabel, portInput);

    // Fréquence d'envoi (Hz)
    const freqGroup = document.createElement("div");
    freqGroup.className = "form-group";
    const freqLabel = document.createElement("label");
    freqLabel.className = "form-label";
    freqLabel.textContent = "Fréquence d'envoi";
    
    const sliderContainer = document.createElement("div");
    sliderContainer.className = "slider-group";
    const freqSlider = document.createElement("input");
    freqSlider.className = "slider-input";
    freqSlider.type = "range";
    freqSlider.min = "1";
    freqSlider.max = "60";
    freqSlider.value = String(config.frequency ?? 24);
    
    const freqValue = document.createElement("span");
    freqValue.className = "slider-val";
    freqValue.textContent = `${freqSlider.value} Hz`;
    
    freqSlider.addEventListener("input", () => {
      freqValue.textContent = `${freqSlider.value} Hz`;
    });
    
    sliderContainer.append(freqSlider, freqValue);
    freqGroup.append(freqLabel, sliderContainer);

    body.append(ipGroup, portGroup, freqGroup);

    // Footer
    const footer = document.createElement("div");
    footer.className = "modal-footer";

    const btnSend = document.createElement("button");
    btnSend.className = "btn";
    btnSend.textContent = "Envoyer Config";
    btnSend.addEventListener("click", async () => {
      await this._app?.sendEhubConfig();
    });

    const btnCancel = document.createElement("button");
    btnCancel.className = "btn";
    btnCancel.textContent = "Annuler";
    btnCancel.addEventListener("click", () => overlay.remove());

    const btnSave = document.createElement("button");
    btnSave.className = "btn btn--primary";
    btnSave.textContent = "Appliquer";
    btnSave.addEventListener("click", () => {
      const host = ipInput.value.trim();
      const port = Number(portInput.value);
      const freq = Number(freqSlider.value);

      if (host && !isNaN(port) && !isNaN(freq)) {
        this._app!.context.transport.updateTarget(host, port);
        // Cast en any pour passer outre le readonly de l'interface ProjectConfig
        const ehub = config.ehub as any;
        ehub.host = host;
        ehub.port = port;
        this._app!.updateFrequency(freq);
        overlay.remove();
      } else {
        alert("Valeurs saisies invalides.");
      }
    });

    footer.append(btnSend, btnCancel, btnSave);
    content.append(header, body, footer);
    overlay.appendChild(content);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
  }

  private _openControllersModal(): void {
    if (!this._app) return;
    const config = this._app.context.project.config;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const content = document.createElement("div");
    content.className = "modal-content";

    // Header
    const header = document.createElement("div");
    header.className = "modal-header";
    const title = document.createElement("span");
    title.className = "modal-title";
    title.textContent = "Contrôleurs Physiques";
    const closeBtn = document.createElement("button");
    closeBtn.className = "modal-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", () => overlay.remove());
    header.append(title, closeBtn);

    // Body
    const body = document.createElement("div");
    body.className = "modal-body";

    const controllersContainer = document.createElement("div");
    controllersContainer.style.display = "flex";
    controllersContainer.style.flexDirection = "column";
    controllersContainer.style.gap = "var(--space-8)";
    body.appendChild(controllersContainer);

    // Copie de travail mutable des IP des contrôleurs
    const ips = config.controllers.map((c) => c.ip);

    const renderList = () => {
      controllersContainer.innerHTML = "";
      ips.forEach((ip, index) => {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "var(--space-8)";

        const label = document.createElement("span");
        label.className = "form-label";
        label.style.minWidth = "60px";
        label.textContent = `Ctrl ${index + 1}`;

        const input = document.createElement("input");
        input.className = "form-input";
        input.style.flex = "1";
        input.type = "text";
        input.value = ip;
        input.placeholder = `192.168.1.${45 + index}`;
        input.addEventListener("input", () => {
          ips[index] = input.value.trim();
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "btn";
        deleteBtn.style.padding = "var(--space-4) var(--space-8)";
        deleteBtn.style.display = "flex";
        deleteBtn.style.alignItems = "center";
        deleteBtn.style.justifyContent = "center";
        deleteBtn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        `;
        deleteBtn.addEventListener("click", () => {
          ips.splice(index, 1);
          renderList();
          updateAddButtonState();
        });

        row.append(label, input, deleteBtn);
        controllersContainer.appendChild(row);
      });
    };

    // Bouton d'ajout +
    const addContainer = document.createElement("div");
    addContainer.style.display = "flex";
    addContainer.style.justifyContent = "flex-start";
    addContainer.style.marginTop = "var(--space-4)";
    body.appendChild(addContainer);

    const addBtn = document.createElement("button");
    addBtn.className = "btn btn--primary";
    addBtn.style.display = "flex";
    addBtn.style.alignItems = "center";
    addBtn.style.gap = "var(--space-4)";
    addBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      <span>Ajouter un contrôleur</span>
    `;

    const updateAddButtonState = () => {
      if (ips.length >= 10) {
        addBtn.disabled = true;
        addBtn.style.opacity = "0.5";
        addBtn.style.cursor = "not-allowed";
      } else {
        addBtn.disabled = false;
        addBtn.style.opacity = "1";
        addBtn.style.cursor = "pointer";
      }
    };

    addBtn.addEventListener("click", () => {
      if (ips.length < 10) {
        const nextSubnet = 45 + ips.length;
        ips.push(`192.168.1.${nextSubnet}`);
        renderList();
        updateAddButtonState();
      }
    });

    addContainer.appendChild(addBtn);

    // Initialisation
    renderList();
    updateAddButtonState();

    // Footer
    const footer = document.createElement("div");
    footer.className = "modal-footer";

    const btnCancel = document.createElement("button");
    btnCancel.className = "btn";
    btnCancel.textContent = "Annuler";
    btnCancel.addEventListener("click", () => overlay.remove());

    const btnSave = document.createElement("button");
    btnSave.className = "btn btn--primary";
    btnSave.textContent = "Appliquer";
    btnSave.addEventListener("click", () => {
      const cleanIps = ips.filter((ip) => ip.trim() !== "");
      const cfg = config as any;
      cfg.controllers = cleanIps.map((ip) => ({ ip }));
      overlay.remove();
    });

    footer.append(btnCancel, btnSave);
    content.append(header, body, footer);
    overlay.appendChild(content);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
  }

  private _project(name: string): HTMLElement {
    const el = document.createElement("span");
    el.className = "menu-bar__project";
    const nameEl = document.createElement("span");
    nameEl.className = "menu-bar__project-name";
    nameEl.textContent = name;
    el.appendChild(nameEl);
    this._projectNameEl = nameEl;

    // Double clic pour renommer le projet
    nameEl.addEventListener("dblclick", () => {
      if (!this._app) return;
      const newName = prompt("Nouveau nom du projet :", nameEl.textContent || "");
      if (newName !== null) {
        const cleaned = newName.trim();
        if (cleaned) {
          const cfg = this._app.context.project.config as any;
          cfg.name = cleaned;
          nameEl.textContent = cleaned;
        }
      }
    });

    return el;
  }
}

function spacer(className: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}
