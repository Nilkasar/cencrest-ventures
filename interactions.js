/* ============================================================
   CENCREST — Interactive Components & Microinteractions
   ============================================================ */

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
});
