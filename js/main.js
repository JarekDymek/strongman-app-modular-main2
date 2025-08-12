// Plik: js/main.js
// Cel: Główny plik aplikacji, który importuje wszystkie inne moduły i łączy je ze sobą, rejestrując detektory zdarzeń.

import * as UI from './ui.js';
import * as State from './state.js';
import * as History from './history.js';
import * as Persistence from './persistence.js';
import * as CompetitorDB from './db-dexie.js';
import * as EventsDB from './eventsDb.js';
import * as Stopwatch from './stopwatch.js';
import * as FocusMode from './focusMode.js';
import * as Handlers from './handlers.js';
import * as CheckpointsDB from './checkpointsDb.js';


// Global helper: show overlay and block interactive controls
function setUIBlocked(blocked) {
    try {
        const overlay = document.getElementById('appLoaderOverlay');

        // Pokaż lub ukryj overlay
        if (blocked) {
            if (overlay) {
                overlay.style.display = 'flex';
                overlay.setAttribute('aria-hidden', 'false');
            }
        } else {
            if (overlay) {
                // drobne opóźnienie, by uniknąć migotania
                setTimeout(() => {
                    overlay.style.display = 'none';
                    overlay.setAttribute('aria-hidden', 'true');
                }, 50);
            }
        }

        // Wyłącz/włącz kontrolki formularzy.
        // Wyjątek: pozostawiamy input[type=file] **włączone**,
        // żeby użytkownik mógł wybrać pliki nawet gdy inne UI jest zablokowane.
        const elems = document.querySelectorAll('button, input, select, textarea');
        elems.forEach(el => {
            try {
                const tag = (el.tagName || '').toLowerCase();
                if (tag === 'input' && el.type === 'file') {
                    el.disabled = false; // pozwól na wybór pliku zawsze
                } else {
                    el.disabled = !!blocked;
                }
            } catch (e) {
                // ignoruj błędy pojedynczych elementów
            }
        });

        // Ustaw focus na overlay gdy zablokowane
        if (blocked && overlay) {
            try { overlay.focus(); } catch (e) {}
        }
    } catch (e) {
        console.warn('setUIBlocked error', e);
    }
}

/**
 * Odświeża cały interfejs użytkownika na podstawie aktualnego stanu aplikacji.
 */
function refreshFullUI() {
    const currentState = State.getState();
    State.setAllDbCompetitors(currentState.allDbCompetitors || []);
    
    if (currentState.competitors && currentState.competitors.length > 0) {
        UI.switchView('main');
        UI.updateEventTitle(currentState.eventNumber, currentState.eventTitle);
        UI.updateEventTypeButtons(currentState.currentEventType);
        UI.renderTable();
        
        const resultInputs = document.querySelectorAll('#resultsTable .resultInput');
        resultInputs.forEach(input => {
            const competitorName = input.dataset.name;
            const event = currentState.eventHistory.find(e => e.nr === currentState.eventNumber);
            if (event) {
                const result = event.results.find(r => r.name === competitorName);
                if (result) {
                    input.value = result.result;
                }
            }
        });

        const lastEvent = currentState.eventHistory[currentState.eventHistory.length - 1];
        if (lastEvent && lastEvent.nr === currentState.eventNumber) {
            UI.updateTableWithEventData(lastEvent.results);
            UI.lockResultInputs();
        }
    } else {
        UI.switchView('intro');
        UI.renderCompetitorSelectionUI(State.getAllDbCompetitors());
    }
    UI.setLogoUI(currentState.logoData);
    UI.DOMElements.eventNameInput.value = currentState.eventName || '';
    UI.DOMElements.eventLocationInput.value = currentState.eventLocation || '';
}

/**
 * Rejestruje wszystkie detektory zdarzeń (event listeners) dla elementów interfejsu.
 */

// Helper: safely add event listeners if element exists
function safeAddListener(id, event, handler) {
    const el = document.getElementById(id);
    if (!el) {
        // element missing — skip and warn
        console.warn('Element with id "' + id + '" not found; skipping listener for ' + event);
        return;
    }
    el.addEventListener(event, handler);
}
function setupEventListeners() {
    Stopwatch.setupStopwatchEventListeners();
    FocusMode.setupFocusModeEventListeners();
    
    // --- General UI & Meta ---
    safeAddListener('themeSelector','change', Handlers.handleThemeChange);
    safeAddListener('selectLogoBtn','click', () => document.getElementById('logoUpload').click());
    safeAddListener('logoUpload','change', Handlers.handleLogoUpload);
    safeAddListener('logoImg','dblclick', Handlers.handleRemoveLogo);
    safeAddListener('eventNameInput','input', (e) => {
        State.state.eventName = e.target.value;
        History.saveToUndoHistory(State.getState());
        Persistence.triggerAutoSave();
    });
    safeAddListener('eventLocationInput','input', (e) => {
        State.state.eventLocation = e.target.value;
        History.saveToUndoHistory(State.getState());
        Persistence.triggerAutoSave();
    });
    safeAddListener('eventTitle','input', (e) => {
        State.state.eventTitle = e.target.textContent;
        History.saveToUndoHistory(State.getState());
        Persistence.triggerAutoSave();
    });

    // --- Intro Screen ---
    safeAddListener('startCompetitionBtn','click', () => {
        if (Handlers.handleStartCompetition()) {
            refreshFullUI();
            }
    });
    safeAddListener('categoryFilters','click', Handlers.handleFilterChange);
    safeAddListener('competitorSelectionList','change', Handlers.handleSelectionChange);

    // --- Main Screen Actions ---
    safeAddListener('shuffleBtn','click', () => {
        if (Handlers.handleShuffle()) {
            UI.renderTable();
        }
    });
    safeAddListener('showResultsBtn','click', UI.toggleHistoryPanel);
    safeAddListener('nextEventBtn','click', async () => {
        if (await Handlers.handleNextEvent()) {
            refreshFullUI();
        }
    });
    safeAddListener('finalEventBtn','click', async () => {
        if (await Handlers.handleFinalEvent()) {
            refreshFullUI();
        }
    });
    safeAddListener('calculatePointsBtn','click', Handlers.handleCalculatePoints);
    safeAddListener('showFinalSummaryBtn','click', UI.renderFinalSummary);
    safeAddListener('highTypeBtn','click', () => Handlers.handleEventTypeChange('high'));
    safeAddListener('lowTypeBtn','click', () => Handlers.handleEventTypeChange('low'));
    safeAddListener('toggleTableWidthBtn','click', (e) => {
        const wrapper = document.querySelector('.table-wrapper');
        wrapper.classList.toggle('expanded');
        e.target.textContent = wrapper.classList.contains('expanded') ? 'Zwiń Tabelę' : 'Rozwiń Tabelę';
    });

    // --- Table & Main Content Clicks ---
    safeAddListener('mainContent','click', (e) => {
        const target = e.target;
        const action = target.dataset.action;
        const competitorName = target.closest('tr')?.dataset.name;

        if (target.closest('.tie-info')) {
            target.closest('.tie-info').classList.toggle('tooltip-active');
        } else if (action === 'showDetails' && competitorName) {
            UI.showCompetitorDetails(State.getCompetitorProfile(competitorName));
        } else if(action === 'openStopwatch' && competitorName) {
            Stopwatch.enterStopwatch(competitorName, Handlers.handleStopwatchSave);
        } else if (target.classList.contains('resultInput') && !target.readOnly) {
            FocusMode.handleEnterFocusMode(target.dataset.name);
        }
    });
    
    // --- POPRAWKA: Precyzyjny zapis po każdej zmianie w polu wyniku ---
    safeAddListener('resultsTable','change', (e) => {
        if (e.target.classList.contains('resultInput')) {
            // Zapisz stan do historii Undo/Redo
            History.saveToUndoHistory(State.getState());
            // Uruchom auto-zapis do localStorage
            Persistence.triggerAutoSave();
            
            // Wizualne potwierdzenie zapisu
            e.target.classList.add('highlight-flash-input');
            setTimeout(() => {
                e.target.classList.remove('highlight-flash-input');
            }, 1000);
        }
    });

    // --- History & Editing ---
    safeAddListener('historyPanel','click', (e) => {
        const eventId = e.target.dataset.eventId;
        if (eventId) UI.renderEventForEditing(parseInt(eventId));
        if (e.target.dataset.action === 'save-recalculate') {
            if (Handlers.handleSaveAndRecalculate(parseInt(e.target.dataset.eventId))) {
                refreshFullUI();
            }
        }
    });
    safeAddListener('undoBtn','click', () => {
        if (Handlers.handleUndo()) {
            refreshFullUI();
        }
    });
    safeAddListener('redoBtn','click', () => {
        if (Handlers.handleRedo()) {
            refreshFullUI();
        }
    });

    // --- Databases & Modals ---
    safeAddListener('manageDbBtn','click', Handlers.handleManageCompetitors);
    safeAddListener('closeDbPanelBtn','click', () => document.getElementById('competitorDbPanel').classList.remove('visible'));
    safeAddListener('exportDbBtn','click', CompetitorDB.exportCompetitorsToJson);
    safeAddListener('importDbTrigger','click', () => document.getElementById('importDbFile').click());
    safeAddListener('importDbFile','change', async (e) => {
            try { setUIBlocked(true); 
 Handlers.handleDbFileImport(e.target.files[0]); e.target.value = null; 
            } finally { setUIBlocked(false); }
        });
    safeAddListener('competitorForm','submit', Handlers.handleCompetitorFormSubmit);
    safeAddListener('competitorListContainer','click', Handlers.handleCompetitorListAction);
    
    safeAddListener('manageEventsDbBtn','click', Handlers.handleManageEvents);
    safeAddListener('eventForm','submit', Handlers.handleEventFormSubmit);
    safeAddListener('eventListContainer','click', Handlers.handleEventListAction);
    safeAddListener('closeEventDbPanelBtn','click', () => document.getElementById('eventDbPanel').classList.remove('visible'));
    safeAddListener('exportEventsDbBtn','click', EventsDB.exportEventsToJson);
    safeAddListener('importEventsDbTrigger','click', () => document.getElementById('importEventsDbFile').click());
    safeAddListener('importEventsDbFile','change', (e) => { Handlers.handleEventsDbFileImport(e.target.files[0]); e.target.value = null; });

    safeAddListener('selectEventFromDbBtn','click', Handlers.handleSelectEventFromDb);
    safeAddListener('selectEventList','click', Handlers.handleEventSelection);
    safeAddListener('selectEventCancelBtn','click', () => document.getElementById('selectEventModal').classList.remove('visible'));
    safeAddListener('competitorDetailCloseBtn','click', () => document.getElementById('competitorDetailModal').classList.remove('visible'));

    // --- Persistence & Export ---
    safeAddListener('exportHtmlBtn','click', Handlers.handleExportHtml);
    safeAddListener('resetCompetitionBtn','click', async (e) => { try { setUIBlocked(true, 'Resetowanie aplikacji...'); const _r = (Persistence.resetApplication).call(this, e); if (_r && _r.then) await _r; } finally { setUIBlocked(false); } });
    safeAddListener('saveCheckpointBtn','click', async (e) => { try { setUIBlocked(true, 'Zapisywanie punktu kontrolnego...'); const _r = (Persistence.saveCheckpoint).call(this, e); if (_r && _r.then) await _r; } finally { setUIBlocked(false); } });
    safeAddListener('showCheckpointsBtn','click', () => Persistence.handleShowCheckpoints());
    safeAddListener('checkpointList','click', (e) => Persistence.handleCheckpointListActions(e, refreshFullUI));
    safeAddListener('exportStateBtn_main','click', () => Persistence.exportStateToFile());
    safeAddListener('importStateBtn_main','click', () => document.getElementById('importFile_main').click());
    safeAddListener('importFile_main','change', async (e) => { 
        if (await Handlers.handleImportState(e.target.files[0])) {
            refreshFullUI();
        }
        e.target.value = null; 
    });
    safeAddListener('exportStateBtn_intro','click', () => Persistence.exportStateToFile(true));
    safeAddListener('importStateBtn_intro','click', () => document.getElementById('importFile_intro').click());
    safeAddListener('importFile_intro','change', async (e) => { 
        if (await Handlers.handleImportState(e.target.files[0])) {
            refreshFullUI();
        }
        e.target.value = null; 
    });

}

/**
 * Główna funkcja inicjalizująca aplikację.
 */
async function initializeApp() {
    try {
        UI.initUI();
        // DODANA LINIA - Inicjalizujemy nasz nowy prompter, aby był gotowy do użycia
        UI.initFullscreenPrompter();
        Stopwatch.initStopwatch();
        
        await CompetitorDB.initDB();
        await EventsDB.initEventsDB();
        await CheckpointsDB.initCheckpointsDB();
        
        await CompetitorDB.seedCompetitorsDatabaseIfNeeded();
        await EventsDB.seedEventsDatabaseIfNeeded();
        
        setupEventListeners();
        // --- Autosave toggle wiring ---
        try {
            const autosaveToggle = document.getElementById('autosaveToggle');
            if (autosaveToggle) {
                autosaveToggle.checked = Persistence.isAutosaveEnabled();
                autosaveToggle.addEventListener('change', (e) => {
                    Persistence.setAutosaveEnabled(e.target.checked);
                    UI.showNotification('Autozapisy ' + (e.target.checked ? 'włączone' : 'wyłączone'), 'info', 1200);
                });
            }
        } catch(err) {
            console.warn('Autosave toggle init failed', err);
        }
        // --- Autosave toggle wiring ---
        try {
            const autosaveToggle = document.getElementById('autosaveToggle');
            if (autosaveToggle) {
                autosaveToggle.checked = Persistence.isAutosaveEnabled();
                autosaveToggle.addEventListener('change', (e) => {
                    Persistence.setAutosaveEnabled(e.target.checked);
                    UI.showNotification('Autozapisy ' + (e.target.checked ? 'włączone' : 'wyłączone'), 'info');
                });
            }
        } catch (e) { console.warn('Autosave toggle init failed', e); }


        const savedTheme = Persistence.loadTheme();
        document.body.className = savedTheme;
        UI.DOMElements.themeSelector.value = savedTheme;

        const loadedFromAutoSave = await Persistence.loadStateFromAutoSave();
        if (loadedFromAutoSave) {
            refreshFullUI();
        } else {
            await Handlers.loadAndRenderInitialData();
            State.state.eventName = UI.DOMElements.eventNameInput.value;
        }
        History.clearHistory();
        History.saveToUndoHistory(State.getState());
        UI.showNotification("Aplikacja gotowa!", "success", 2000);
    } catch (error) {
        console.error("Krytyczny błąd podczas inicjalizacji:", error);
        UI.showNotification("Wystąpił błąd krytyczny. Odśwież stronę.", "error", 10000);
    }
}

// Uruchomienie aplikacji po załadowaniu drzewa DOM
document.addEventListener('DOMContentLoaded', initializeApp);