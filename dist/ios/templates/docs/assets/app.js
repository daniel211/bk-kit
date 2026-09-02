/* beer-kit docs site — vanilla JS, no framework */

(function () {
  'use strict';

  // ─── Sidebar collapse/expand ──────────────────────────────────
  function initNavGroups() {
    var currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-group').forEach(function (group) {
      var trigger = group.querySelector('.nav-item');
      if (!trigger) return;
      var targetPage = trigger.dataset.page || '';

      trigger.addEventListener('click', function (e) {
        // Don't interfere with sub-item link clicks
        if (e.target.closest('.nav-sub-item')) return;
        // If already on this page, just toggle submenu
        if (targetPage === currentPage || targetPage.split('#')[0] === currentPage) {
          group.classList.toggle('open');
        } else if (targetPage) {
          // Navigate to the page
          window.location.href = targetPage;
        } else {
          group.classList.toggle('open');
        }
      });

      // Keyboard support
      trigger.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          trigger.click();
        }
      });
    });
  }

  // ─── Active page highlight ────────────────────────────────────
  function highlightActivePage() {
    var currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('[data-page]').forEach(function (el) {
      if (el.dataset.page === currentPage) {
        el.classList.add('active');
        // Also open parent nav-group if sub-item is active
        var group = el.closest('.nav-group');
        if (group) group.classList.add('open');
      } else {
        el.classList.remove('active');
      }
    });
  }

  // ─── Mobile hamburger toggle ──────────────────────────────────
  function initMobileMenu() {
    var hamburger = document.querySelector('.hamburger');
    var sidebar   = document.querySelector('.sidebar');
    var overlay   = document.querySelector('.sidebar-overlay');
    if (!hamburger || !sidebar) return;

    function openSidebar() {
      sidebar.classList.add('open');
      if (overlay) overlay.classList.add('visible');
      hamburger.setAttribute('aria-expanded', 'true');
    }

    function closeSidebar() {
      sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('visible');
      hamburger.setAttribute('aria-expanded', 'false');
    }

    hamburger.addEventListener('click', function () {
      sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    });

    if (overlay) {
      overlay.addEventListener('click', closeSidebar);
    }

    // Close on nav link click (mobile)
    document.querySelectorAll('.nav-sub-item[data-page], .nav-item[data-page]').forEach(function (link) {
      link.addEventListener('click', function () {
        if (window.innerWidth <= 768) closeSidebar();
      });
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
    });
  }

  // ─── Search / filter cards ────────────────────────────────────
  function initSearch() {
    var input = document.querySelector('.search-input');
    if (!input) return;

    input.addEventListener('input', function () {
      var query = input.value.trim().toLowerCase();
      filterCards(query);
    });
  }

  function filterCards(query) {
    var cards      = document.querySelectorAll('.card[data-search]');
    var emptyState = document.querySelector('.empty-state');
    var visible    = 0;

    cards.forEach(function (card) {
      var haystack = (card.dataset.search || '').toLowerCase();
      var match    = !query || haystack.includes(query);
      card.classList.toggle('hidden', !match);
      if (match) visible++;
    });

    if (emptyState) {
      emptyState.classList.toggle('visible', visible === 0 && query.length > 0);
    }
  }

  // ─── Filter tabs (type filter) ────────────────────────────────
  function initFilterTabs() {
    document.querySelectorAll('.filter-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        // Toggle active on clicked tab
        document.querySelectorAll('.filter-tab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');

        var filter = tab.dataset.filter || 'all';
        applyTypeFilter(filter);
      });
    });
  }

  function applyTypeFilter(filter) {
    var cards      = document.querySelectorAll('.card[data-type]');
    var emptyState = document.querySelector('.empty-state');
    var visible    = 0;

    // Also respect active search query
    var searchQuery = '';
    var searchInput = document.querySelector('.search-input');
    if (searchInput) searchQuery = searchInput.value.trim().toLowerCase();

    cards.forEach(function (card) {
      var typeMatch   = filter === 'all' || card.dataset.type === filter;
      var searchMatch = !searchQuery || (card.dataset.search || '').toLowerCase().includes(searchQuery);
      var show        = typeMatch && searchMatch;
      card.classList.toggle('hidden', !show);
      if (show) visible++;
    });

    if (emptyState) {
      emptyState.classList.toggle('visible', visible === 0);
    }
  }

  // ─── Platform selector sync ───────────────────────────────────
  function initPlatformSelector() {
    var select = document.querySelector('.platform-select');
    if (!select) return;

    // Read from URL param or localStorage
    var stored = localStorage.getItem('bk-platform') || 'ios';
    select.value = stored;
    applyPlatform(stored);

    select.addEventListener('change', function () {
      var platform = select.value;
      localStorage.setItem('bk-platform', platform);
      applyPlatform(platform);
    });
  }

  function applyPlatform(platform) {
    // Update platform badge if present
    document.querySelectorAll('.platform-badge').forEach(function (badge) {
      var icons = { ios: '🍎', android: '🤖', flutter: '💙' };
      badge.textContent = (icons[platform] || '') + ' ' + platform;
    });

    // Show/hide platform-specific cards
    document.querySelectorAll('.card[data-type]').forEach(function (card) {
      var type = card.dataset.type;
      var isPlatformCard = type === 'ios' || type === 'android' || type === 'flutter';
      if (isPlatformCard && type !== platform) {
        card.style.display = 'none';
      } else {
        card.style.display = '';
      }
    });

    // Re-run filter to keep search/filter consistent
    var activeTab = document.querySelector('.filter-tab.active');
    if (activeTab) applyTypeFilter(activeTab.dataset.filter || 'all');
  }

  // ─── Smooth scroll for hash links ────────────────────────────
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener('click', function (e) {
        var target = document.querySelector(this.getAttribute('href'));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  // ─── Highlight.js init (if present) ──────────────────────────
  function initHighlight() {
    if (typeof hljs !== 'undefined') {
      hljs.highlightAll();
    }
  }

  // ─── Platform button click (index.html) ──────────────────────
  function initPlatformButtons() {
    document.querySelectorAll('.platform-btn[data-platform]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var platform = btn.dataset.platform;
        localStorage.setItem('bk-platform', platform);
        // Navigate to agents page with chosen platform
        window.location.href = 'agents.html?platform=' + platform;
      });
    });
  }

  // ─── Read platform from URL param on page load ────────────────
  function readPlatformFromUrl() {
    var params   = new URLSearchParams(window.location.search);
    var platform = params.get('platform');
    if (platform) {
      localStorage.setItem('bk-platform', platform);
    }
  }

  // ─── Language toggle ────────────────────────────────────────────
  function initLangToggle() {
    var currentLang = localStorage.getItem('bk-lang') || 'vi';
    // Set active state on load
    document.querySelectorAll('.lang-btn').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.dataset.lang === currentLang ? 'true' : 'false');
    });
    // Handle clicks — reload page to apply new language
    document.querySelectorAll('.lang-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var lang = btn.dataset.lang;
        localStorage.setItem('bk-lang', lang);
        // Reload with lang param so server can serve correct build
        var url = new URL(window.location.href);
        url.searchParams.set('lang', lang);
        window.location.href = url.toString();
      });
    });
  }

  // ─── Boot ─────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    readPlatformFromUrl();
    initNavGroups();
    highlightActivePage();
    initMobileMenu();
    initSearch();
    initFilterTabs();
    initPlatformSelector();
    initSmoothScroll();
    initHighlight();
    initPlatformButtons();
    initLangToggle();
  });
}());
