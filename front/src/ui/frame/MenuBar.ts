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
      // seules les cellules en diagonale sont allumées (cf. proto)
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
      } else if (label === "Composition") {
        const dropdown = this._createCompositionDropdown();
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

    dropdown.append(ehubItem);
    return dropdown;
  }

  private _createCompositionDropdown(): HTMLElement {
    const dropdown = document.createElement("div");
    dropdown.className = "menu-item__dropdown";

    const item = (label: string, run: () => void): HTMLElement => {
      const el = document.createElement("div");
      el.className = "menu-dropdown__item";
      el.textContent = label;
      el.addEventListener("click", run);
      return el;
    };

    dropdown.append(
      item("Précomposer la sélection", () => this._app?.context.editor.precomposeSelection()),
      item("Nouvelle précomposition", () => this._app?.context.editor.addPrecomp()),
      item("Nouveau prérendu", () => this._app?.context.editor.addPrerender()),
    );
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
