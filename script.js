// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyCgT_toG_8iydM3VCBE4DGW8XCE4aykRmQ",
  authDomain: "with-quran.firebaseapp.com",
  projectId: "with-quran",
  storageBucket: "with-quran.firebasestorage.app",
  messagingSenderId: "15818126128",
  appId: "1:15818126128:web:c0b04500e72af17c0acef5",
  measurementId: "G-JLST517CJT"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;

const state = {
    currentView: 'home',
    quranData: [], // Stores Surah list
    currentSurah: null,
    currentSurahData: null,
    audioPlaying: false,
    audioSource: null,
    currentAudioKey: null, // Track currently playing ayah key for auto-play
    bookmarks: JSON.parse(localStorage.getItem('bookmarks')) || [],
    settings: {
        language: 'en', // en, ml, hi
        script: 'uthmani',
        fontSize: 32,
        theme: localStorage.getItem('theme') || 'light'
    }
};

// DOM Elements
const app = document.getElementById('app');
const themeBtn = document.getElementById('theme-btn');
const surahGrid = document.getElementById('surah-grid');
const globalSearch = document.getElementById('global-search');
const audioPlayer = document.getElementById('main-audio');
const playPauseBtn = document.getElementById('audio-play-pause');
const contentArea = document.getElementById('content-area');

// API Endpoints
const API_BASE = 'https://api.quran.com/api/v4';
const AUDIO_BASE = 'https://verses.quran.com/';

// Translations Map (Resource IDs from Quran.com)
const TRANSLATIONS = {
    en: 85, // Sahih International
    ml: 201, // Abdul Hameed & Parappoor
    hi: 153  // Muhammad Farooq Khan / Mixed
};

// Initialize
async function init() {
    applyTheme();
    updateDate();
    setupEventListeners();
    setupFirebase();
    await fetchSurahs();
    loadHeroAyah();
    renderSurahs(state.quranData);
    lucide.createIcons();
}

// Event Listeners
function setupEventListeners() {
    // Theme Toggle
    themeBtn.addEventListener('click', () => {
        state.settings.theme = state.settings.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('theme', state.settings.theme);
        applyTheme();
    });

    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Handle active class
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active'); // Use currentTarget to get the button

            const view = e.currentTarget.dataset.view;
            switchView(view);
        });
    });

    // Search
    globalSearch.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        if (state.currentView === 'home') {
            const filtered = state.quranData.filter(surah =>
                surah.name_simple.toLowerCase().includes(query) ||
                surah.name_arabic.includes(query) ||
                String(surah.id).includes(query)
            );
            renderSurahs(filtered);
        }
    });

    // Back Button
    document.getElementById('back-to-home').addEventListener('click', () => {
        switchView('home');
    });

    // Surah Navigation
    const surahSelector = document.getElementById('surah-selector');
    surahSelector.addEventListener('change', (e) => {
        openSurah(parseInt(e.target.value));
    });

    document.getElementById('prev-surah-btn').addEventListener('click', () => {
        if (state.currentSurah && state.currentSurah.id > 1) {
            openSurah(state.currentSurah.id - 1);
        }
    });

    document.getElementById('next-surah-btn').addEventListener('click', () => {
        if (state.currentSurah && state.currentSurah.id < 114) {
            openSurah(state.currentSurah.id + 1);
        }
    });

    // View in PDF Button
    document.getElementById('view-in-pdf-btn').addEventListener('click', () => {
        switchView('pdf');
    });

    // Play Full Surah Button
    document.getElementById('play-surah-btn').addEventListener('click', () => {
        if (state.currentSurah) {
            // Play first ayah of the current surah
            playAyah(`${state.currentSurah.id}:1`);
        }
    });

    // Settings Inputs
    document.querySelector('#setting-fontsize').addEventListener('input', (e) => {
        const size = e.target.value;
        document.documentElement.style.setProperty('--font-arabic-size', `${size}px`);
        document.querySelectorAll('.ayah-text-ar').forEach(el => {
            el.style.fontSize = `${size}px`;
        });
    });

    // Audio Controls
    playPauseBtn.addEventListener('click', toggleAudio);

    // Audio Time Update
    audioPlayer.addEventListener('timeupdate', () => {
        const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        document.getElementById('audio-seeker').value = progress || 0;
    });

    // Audio Ended (Auto Play Next)
    audioPlayer.addEventListener('ended', playNextAyah);

    // Seek
    document.getElementById('audio-seeker').addEventListener('input', (e) => {
        const time = (e.target.value / 100) * audioPlayer.duration;
        audioPlayer.currentTime = time;
    });
}

function setupFirebase() {
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userProfile = document.getElementById('user-profile');
    const userAvatar = document.getElementById('user-avatar');
    const userName = document.getElementById('user-name');

    loginBtn.addEventListener('click', () => {
        const provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider).catch(error => alert("Login failed: " + error.message));
    });

    logoutBtn.addEventListener('click', () => {
        auth.signOut();
    });

    auth.onAuthStateChanged(async (user) => {
        currentUser = user;
        if (user) {
            loginBtn.style.display = 'none';
            userProfile.classList.remove('hidden');
            userAvatar.src = user.photoURL || '';
            userName.textContent = user.displayName;
            
            // Fetch bookmarks from Firestore
            await syncBookmarksFromCloud();
        } else {
            loginBtn.style.display = 'flex';
            userProfile.classList.add('hidden');
        }
    });
}

async function syncBookmarksFromCloud() {
    if (!currentUser) return;
    try {
        const docRef = db.collection('users').doc(currentUser.uid);
        const doc = await docRef.get();
        if (doc.exists) {
            const cloudBookmarks = doc.data().bookmarks || [];
            // Merge with local
            const merged = [...new Set([...state.bookmarks, ...cloudBookmarks])];
            state.bookmarks = merged;
            localStorage.setItem('bookmarks', JSON.stringify(state.bookmarks));
            
            // Save merged back to cloud
            await docRef.set({ bookmarks: state.bookmarks }, { merge: true });
        } else {
            // First time login, save local to cloud
            await docRef.set({ bookmarks: state.bookmarks });
        }
        if (state.currentView === 'bookmarks') renderBookmarks();
    } catch (e) {
        console.error("Error syncing bookmarks", e);
    }
}

async function saveBookmarksToCloud() {
    if (!currentUser) return;
    try {
        await db.collection('users').doc(currentUser.uid).set({
            bookmarks: state.bookmarks
        }, { merge: true });
    } catch (e) {
        console.error("Failed to save to cloud", e);
    }
}

// Logic Functions

function applyTheme() {
    document.body.setAttribute('data-theme', state.settings.theme);
}

function updateDate() {
    const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('hijri-date').textContent = date;
}

function switchView(viewName) {
    state.currentView = viewName;

    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    // Show target
    const target = document.getElementById(`view-${viewName === 'read' ? 'read' : viewName}`);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('active');
    }

    if (viewName === 'bookmarks') {
        renderBookmarks();
    }
}

async function fetchSurahs() {
    try {
        const res = await fetch(`${API_BASE}/chapters?language=en`);
        const data = await res.json();
        state.quranData = data.chapters;
        populateSurahDropdown(data.chapters);
    } catch (error) {
        console.error("Failed to fetch Surahs", error);
        surahGrid.innerHTML = '<p class="error">Failed to load content. Please check internet.</p>';
    }
}

function populateSurahDropdown(chapters) {
    const selector = document.getElementById('surah-selector');
    selector.innerHTML = chapters.map(s => `<option value="${s.id}">${s.id}. ${s.name_simple}</option>`).join('');

    const pdfIndex = document.getElementById('pdf-surah-index');
    if (pdfIndex) {
        // Special Items Prepend
        let html = `
            <div class="pdf-index-item special-item-fp" onclick="showFrontPage()">
                <i data-lucide="book" style="width: 18px;"></i>
                 <span>Front Page</span>
            </div>
            <div class="pdf-index-item special-item-fatiha" onclick="openSurah(1)">
                <span>✨ Surah Al-Fatiha</span>
                <span class="arabic-text-sm">الفاتحة</span>
            </div>
        `;

        // Add others (excluding Fatiha as it's featured)
        html += chapters.filter(s => s.id !== 1).map(s => `
            <div class="pdf-index-item" onclick="jumpToPdfSurah(${s.id})">
                <span>${s.id}. ${s.name_simple}</span>
                <span class="arabic-text-sm">${s.name_arabic}</span>
            </div>
        `).join('');

        pdfIndex.innerHTML = html;
        lucide.createIcons();
    }
}

function showFrontPage() {
    switchView('pdf');
    document.getElementById('quran-front-page').classList.remove('hidden');
    document.getElementById('pdf-viewer-container').classList.add('hidden');
}

function jumpToPdfSurah(id) {
    // Navigate PDF if we want to stay in view-pdf, or openSurah (Text)
    // The user wants "one by one readable content" so we open the reader.
    openSurah(id);
}

function renderSurahs(list) {
    surahGrid.innerHTML = '';

    list.forEach(surah => {
        const card = document.createElement('div');
        card.className = 'surah-card';
        card.innerHTML = `
            <div class="surah-number">${surah.id}</div>
            <div class="surah-details">
                <div class="surah-name-en">${surah.name_simple}</div>
                <div class="surah-name-tr">${surah.translated_name.name}</div>
                <span class="surah-verses-count">${surah.verses_count} Verses</span>
            </div>
            <div class="surah-name-ar">${surah.name_arabic}</div>
        `;
        card.addEventListener('click', () => openSurah(surah.id));
        surahGrid.appendChild(card);
    });
}

async function loadHeroAyah() {
    // Random Ayah for demo: 2:255 (Ayatul Kursi)
    try {
        const res2 = await fetch(`${API_BASE}/verses/by_key/2:255?language=en&words=true&translations=131&fields=text_uthmani,text_indopak`);
        const data = await res2.json();

        if (data.verse) {
            document.getElementById('daily-ayah-text').innerText = data.verse.text_uthmani;
            document.getElementById('daily-ayah-translation').innerText = data.verse.translations[0].text.replace(/<[^>]*>?/gm, ''); // strip html
            document.getElementById('daily-ayah-meta').innerHTML = `<span>Surah Al-Baqarah, Ayah 255</span><button class="play-btn-hero"><i data-lucide="play"></i> Listen</button>`;

            document.querySelector('.play-btn-hero').addEventListener('click', () => playAyah("2:255"));
        }
    } catch (e) {
        console.log("Hero fetch error", e);
    }
}

async function openSurah(id) {
    const surah = state.quranData.find(s => s.id === id);
    if (!surah) return;
    state.currentSurah = surah;

    // UI Update
    document.getElementById('surah-selector').value = id;

    // Fatiha Decoration Logic
    const readView = document.getElementById('view-read');
    const fatihaLayer = document.getElementById('fatiha-bg-layer');
    if (id === 1) {
        readView.classList.add('fatiha-mode');
        fatihaLayer.classList.remove('hidden');
    } else {
        readView.classList.remove('fatiha-mode');
        fatihaLayer.classList.add('hidden');
    }

    // Bismillah Logic
    const bismillahSection = document.getElementById('bismillah-section');
    if (id === 9 || id === 1) { // Tawbah (9) no Bismillah. Fatiha (1) is verse 1.
        bismillahSection.style.display = 'none';
    } else {
        bismillahSection.style.display = 'block';
    }

    // Switch View
    switchView('read');

    // Loading State
    const container = document.getElementById('ayah-container');
    container.innerHTML = '<div class="loading-spinner">Loading Verses...</div>';

    // Fetch Ayahs
    try {
        const res = await fetch(`${API_BASE}/verses/by_chapter/${id}?language=en&words=false&translations=${TRANSLATIONS[state.settings.language] || 131}&fields=text_uthmani&per_page=100`);
        const data = await res.json();
        state.currentSurahData = data.verses;
        renderAyahs(data.verses);
    } catch (e) {
        container.innerHTML = '<p class="error">Failed to load verses.</p>';
        console.error(e);
    }
}

function renderAyahs(verses) {
    const container = document.getElementById('ayah-container');
    container.innerHTML = '';

    verses.forEach(verify => {
        const div = document.createElement('div');
        div.className = 'ayah-item';
        div.id = `ayah-${verify.verse_key}`;

        // Extract Ayah number
        const ayahNum = verify.verse_key.split(':')[1];
        const arabicNum = toArabicNumerals(ayahNum);

        div.innerHTML = `
            <div class="ayah-header">
                <span class="ayah-number">${verify.verse_key}</span>
                <div class="ayah-actions">
                   <button onclick="playAyah('${verify.verse_key}')" title="Play"><i data-lucide="play-circle"></i></button>
                   <button onclick="bookmarkAyah('${verify.verse_key}')" title="Bookmark"><i data-lucide="bookmark"></i></button>
                   <button title="Share"><i data-lucide="share-2"></i></button>
                </div>
            </div>
            <div class="ayah-text-ar">
                ${verify.text_uthmani} <span class="ayah-end-symbol">۝${arabicNum}</span>
            </div>
            <div class="ayah-translation">${verify.translations[0].text}</div>
        `;

        container.appendChild(div);
    });

    lucide.createIcons();
}

function toArabicNumerals(n) {
    return n.toString().replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
}

function renderBookmarks() {
    const list = document.getElementById('bookmarks-list');
    if (state.bookmarks.length === 0) {
        list.innerHTML = '<p class="empty-state">No bookmarks yet. Go to a Surah and click the bookmark icon.</p>';
        return;
    }

    list.innerHTML = state.bookmarks.map(b => {
        const [surahId, ayahNum] = b.split(':');
        const surah = state.quranData.find(s => s.id == surahId);
        const surahName = surah ? surah.name_simple : 'Surah ' + surahId;
        return `
            <div class="bookmark-item" onclick="openBookmarkedAyah('${b}')">
                <div class="bookmark-info">
                    <i data-lucide="bookmark" class="bookmark-icon"></i>
                    <div class="bookmark-text">
                        <span class="bookmark-title">${surahName}</span>
                        <span class="bookmark-subtitle">Ayah ${ayahNum}</span>
                    </div>
                </div>
                <button class="remove-bookmark-btn" onclick="event.stopPropagation(); removeBookmark('${b}')" title="Remove">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;
    }).join('');
    lucide.createIcons();
}

async function openBookmarkedAyah(key) {
    const [surahId, ayahNum] = key.split(':');
    await openSurah(parseInt(surahId));
    
    setTimeout(() => {
        const targetRow = document.getElementById(`ayah-${key}`);
        if (targetRow) {
            targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
            targetRow.classList.add('active');
            setTimeout(() => targetRow.classList.remove('active'), 2000);
        }
    }, 500);
}

function removeBookmark(key) {
    state.bookmarks = state.bookmarks.filter(b => b !== key);
    localStorage.setItem('bookmarks', JSON.stringify(state.bookmarks));
    saveBookmarksToCloud();
    renderBookmarks();
}

function bookmarkAyah(key) {
    if (!state.bookmarks.includes(key)) {
        state.bookmarks.push(key);
        localStorage.setItem('bookmarks', JSON.stringify(state.bookmarks));
        saveBookmarksToCloud();
        alert('Ayah Bookmarked!');
    } else {
        alert('Already bookmarked');
    }
}

// Audio Stuff

function playAyah(verseKey) {
    // Parse key "1:1" -> Surah 1, Ayah 1
    const [surah, ayah] = verseKey.split(':');

    // Update State
    state.currentAudioKey = verseKey;

    // Highlighting
    document.querySelectorAll('.ayah-item').forEach(i => i.classList.remove('active'));
    const targetRow = document.getElementById(`ayah-${verseKey}`);
    if (targetRow) {
        targetRow.classList.add('active');
        // Optional: Smooth scroll to active ayah
        targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    const padSurah = String(surah).padStart(3, '0');
    const padAyah = String(ayah).padStart(3, '0');

    const url = `https://everyayah.com/data/Alafasy_128kbps/${padSurah}${padAyah}.mp3`;

    audioPlayer.src = url;
    document.getElementById('audio-player-bar').classList.remove('hidden');
    document.getElementById('audio-surah-name').textContent = state.currentSurah ? state.currentSurah.name_simple : 'Surah ' + surah;
    document.getElementById('audio-ayah-number').textContent = `Ayah ${ayah}`;

    audioPlayer.play();
    state.audioPlaying = true;
    updatePlayBtnIO();
}

function playNextAyah() {
    if (!state.currentAudioKey) return;

    const [surah, ayah] = state.currentAudioKey.split(':');
    const nextAyahNum = parseInt(ayah) + 1;
    const nextKey = `${surah}:${nextAyahNum}`;

    if (document.getElementById(`ayah-${nextKey}`)) {
        playAyah(nextKey);
    } else {
        // End of list or surah
        state.audioPlaying = false;
        updatePlayBtnIO();
    }
}

function toggleAudio() {
    if (audioPlayer.paused) {
        audioPlayer.play();
        state.audioPlaying = true;
    } else {
        audioPlayer.pause();
        state.audioPlaying = false;
    }
    updatePlayBtnIO();
}

function updatePlayBtnIO() {
    const icon = state.audioPlaying ? 'pause' : 'play';
    playPauseBtn.innerHTML = `<i data-lucide="${icon}"></i>`;
    lucide.createIcons();
}

function jumpToPdfSurah(id) {
    // Instead of alerting, we now open the "readable written content" (Interactive Text Reader)
    // for the selected Surah. This provides the best reading experience with translations.
    openSurah(id);
}

// Expose functions to global scope for HTML onclick
window.playAyah = playAyah;
window.bookmarkAyah = bookmarkAyah;
window.jumpToPdfSurah = jumpToPdfSurah;
window.showFrontPage = showFrontPage;
window.openBookmarkedAyah = openBookmarkedAyah;
window.removeBookmark = removeBookmark;

// Start
init();
