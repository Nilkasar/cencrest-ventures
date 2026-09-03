/* ============================================================
   CENCREST — Interactive Components & Microinteractions
   ============================================================ */

// Epic 20 (Marketing Site Rebuild) — real backend for the `.apply-form`
// forms on index.html (#apply) and contact.html. Both post the same
// sales-intent lead shape to POST /api/apply (see
// platform/apps/api/src/routes/apply.ts) — never the free-snapshot flow,
// which stays a plain link to https://app.bebestwithai.com/snapshot.
//
// API_ORIGIN is a build-time assumption: no ARCHITECTURE doc in this repo
// names the deployed API domain, so this follows the app.bebestwithai.com
// subdomain convention the API's own CORS allowlist already uses
// (app.ts). Verify against the real deployed API URL before going live —
// this is the one line to change if it's wrong.
const API_ORIGIN = (() => {
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3001';
  return 'https://api.bebestwithai.com';
})();

function wireApplyForm(form) {
  if (!form) return;
  const submitBtn = form.querySelector('button[type="submit"]');
  const successEl = form.querySelector('[data-form-success]');
  const errorEl = form.querySelector('[data-form-error]');
  const submitLabel = submitBtn ? submitBtn.textContent : '';

  const resetStatus = () => {
    if (successEl) { successEl.hidden = true; successEl.textContent = ''; }
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
  };

  const showError = (msg) => {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.hidden = false;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    resetStatus();

    // novalidate is set on both forms so this handler always runs; native
    // constraint validation (required / type=email / maxlength, mirroring
    // the backend's Zod schema) still gates the actual submit here.
    if (!form.reportValidity()) return;

    const data = new FormData(form);
    const get = (name) => (data.get(name) || '').toString().trim();

    // contact.html's form carries an extra "What are you looking for?"
    // field the /api/apply schema doesn't have a slot for — fold it into
    // notes rather than silently dropping it.
    const service = get('service');
    const rawNotes = get('notes');
    const notes = [service ? `Interested in: ${service}` : '', rawNotes].filter(Boolean).join('\n\n');

    const payload = {
      name: get('name'),
      email: get('email'),
      company: get('company'),
    };
    const category = get('category');
    if (category) payload.category = category;
    if (notes) payload.notes = notes;
    const honeypot = get('hp_field');
    if (honeypot) payload.hp_field = honeypot;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="apply-btn-spinner" aria-hidden="true"></span>Sending…';
    }
    form.setAttribute('aria-busy', 'true');

    try {
      const res = await fetch(`${API_ORIGIN}/api/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 201) {
        const json = await res.json().catch(() => null);
        if (successEl) {
          successEl.textContent = (json && json.message) || 'Request received. The BeBest team will be in touch within 24 hours.';
          successEl.hidden = false;
        }
        form.reset();
        Array.from(form.elements).forEach((el) => {
          if (el !== submitBtn) el.disabled = true;
        });
        if (submitBtn) submitBtn.hidden = true;
      } else if (res.status === 422) {
        const json = await res.json().catch(() => null);
        const issues = json && Array.isArray(json.issues) && json.issues.length
          ? json.issues.map((i) => i.message).join(' ')
          : 'Please check the highlighted fields and try again.';
        showError(issues);
      } else if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? ` in about ${Math.max(1, Math.ceil(retryAfter / 60))} minute(s)`
          : ' shortly';
        showError(`You've sent a few of these already — please try again${wait}, or email hello@bebestwithai.com directly.`);
      } else {
        showError('Something went wrong on our end. Please try again, or email hello@bebestwithai.com directly.');
      }
    } catch (err) {
      showError('We could not reach the server. Check your connection and try again, or email hello@bebestwithai.com directly.');
    } finally {
      form.removeAttribute('aria-busy');
      if (submitBtn && !submitBtn.hidden) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitLabel;
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // 1. Navigation Scroll Backdrop
  const nav = document.getElementById('nav');
  const railProgress = document.querySelector('.rail-progress');

  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }

    // Rail progress line height
    const docH = document.documentElement.scrollHeight - window.innerHeight;
    if (docH > 0 && railProgress) {
      const pct = (window.scrollY / docH) * 100;
      railProgress.style.height = `${pct}%`;
    }
  }, { passive: true });

  // 2. Company Blank Auto-Resizing Input (Section 02)
  const compInput = document.getElementById('company-input');
  if (compInput) {
    const updateWidth = () => {
      const val = compInput.value || compInput.placeholder || 'your company';
      compInput.style.width = `${val.length}ch`;
    };
    compInput.addEventListener('input', updateWidth);
    compInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('chorus')?.scrollIntoView({ behavior: 'smooth' });
      }
    });
    updateWidth();
  }

  // 3. Chorus Typewriter Ticker & Answers (Section 03)
  const chorusPromptText = document.getElementById('chorus-prompt-text');
  const chorusAnswers = [
    document.getElementById('ans-0'),
    document.getElementById('ans-1'),
    document.getElementById('ans-2'),
    document.getElementById('ans-3')
  ];
  const chorusVerdict = document.getElementById('chorus-verdict');

  const fullPrompt = 'Which logistics visibility platforms are best for mid-market fleets?';
  const modelResponses = [
    'For mid-market logistics, most teams recommend <span class="highlight">Northwind</span>, <span class="highlight">Delta Rail</span>, and <span class="highlight">Copperline</span> based on deployment speed and fleet tracking accuracy.',
    'Top choices include <span class="highlight">Northwind</span> (highest customer satisfaction), <span class="highlight">Delta Rail</span> (best enterprise API), and <span class="highlight">Copperline</span> for real-time telemetry.',
    'Based on recent trade benchmarks: 1. <span class="highlight">Northwind</span> 2. <span class="highlight">Delta Rail</span> 3. <span class="highlight">Copperline</span>. These three capture 72% of mid-market recommendations.',
    '<span class="highlight">Northwind</span> leads in onboarding speed (median 9 days), followed by <span class="highlight">Delta Rail</span> and <span class="highlight">Copperline</span> for TMS integrations.'
  ];

  let chorusTriggered = false;
  const triggerChorus = () => {
    if (chorusTriggered) return;
    chorusTriggered = true;

    let pIdx = 0;
    const typePrompt = setInterval(() => {
      if (chorusPromptText) chorusPromptText.textContent = fullPrompt.slice(0, pIdx);
      pIdx++;
      if (pIdx > fullPrompt.length) {
        clearInterval(typePrompt);
        // Start typing answers into columns
        modelResponses.forEach((resp, colIdx) => {
          setTimeout(() => {
            if (chorusAnswers[colIdx]) chorusAnswers[colIdx].innerHTML = resp;
          }, colIdx * 300);
        });

        setTimeout(() => {
          if (chorusVerdict) {
            chorusVerdict.textContent = 'RESOLVED · 4 OF 4 MODELS RETURNED THE SAME THREE COMPETITORS. YOUR COMPANY WAS NOT RETRIEVED.';
            chorusVerdict.classList.add('visible');
          }
        }, 1600);
      }
    }, 30);
  };

  const chorusSec = document.getElementById('chorus');
  if (chorusSec) {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        triggerChorus();
      }
    }, { threshold: 0.2 });
    observer.observe(chorusSec);
  }

  // 4. Scroll Spy for Section 05 Signals TOC
  const tocLinks = document.querySelectorAll('.signals-toc-item');
  const signalBlocks = document.querySelectorAll('.signal-block');

  if (tocLinks.length && signalBlocks.length) {
    const spyObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          tocLinks.forEach(link => {
            if (link.getAttribute('href') === `#${id}`) {
              link.classList.add('active');
            } else {
              link.classList.remove('active');
            }
          });
        }
      });
    }, { threshold: 0.4 });

    signalBlocks.forEach(block => spyObserver.observe(block));
  }

  // 5. Initialize Source Field Canvas
  const sourcesCanvas = document.getElementById('sources-canvas');
  if (sourcesCanvas && window.SourceField) {
    new window.SourceField(sourcesCanvas);
  }

  // 6. Initialize Hero Film Canvas
  const filmTrack = document.getElementById('film-track');
  const filmCanvas = document.getElementById('film-canvas');
  if (filmTrack && filmCanvas && window.HeroFilm) {
    new window.HeroFilm({
      track: filmTrack,
      canvas: filmCanvas,
      actEl: document.getElementById('film-act'),
      promptEl: document.getElementById('film-prompt'),
      promptTextEl: document.getElementById('film-prompt-text'),
      verdictEl: document.getElementById('film-verdict'),
      verdictKickEl: document.getElementById('film-verdict-kick'),
      verdictBodyEl: document.getElementById('film-verdict-body'),
      finalEl: document.getElementById('film-final'),
      hintEl: document.getElementById('film-hint'),
      barFillEl: document.getElementById('film-bar-fill')
    });
  }

  // 7. Wire every sales-intent lead form (#apply on index.html,
  // contact.html's form) to the real POST /api/apply backend.
  document.querySelectorAll('.apply-form').forEach(wireApplyForm);
});
