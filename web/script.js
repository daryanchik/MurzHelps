"use strict";

// Platform downloads and repository links.
const SITE = Object.freeze({
  repositoryUrl: "https://github.com/daryanchik/MurzHelps",
downloadUrl: "https://github.com/daryanchik/MurzHelps/releases/latest/download/MurzHelps_MacOS.dmg",
windowsDownloadUrl: "https://github.com/daryanchik/MurzHelps/releases/latest/download/MurzHelps_Windows.exe",
  catImage: "./assets/murz-hero.png",
});

function safeHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function repositoryUrl(value) {
  const valid = safeHttps(value);
  if (!valid) return null;
  const url = new URL(valid);
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname !== "github.com" || parts.length !== 2) return null;
  return `https://github.com/${parts[0]}/${parts[1]}`;
}

function activateLinks(selector, url) {
  if (!url) return;
  document.querySelectorAll(selector).forEach(link => {
    link.href = url;
    link.removeAttribute("aria-disabled");
  });
}

const repo = repositoryUrl(SITE.repositoryUrl);
const releases = repo ? `${repo}/releases` : null;
const directDownload = safeHttps(SITE.downloadUrl);
const windowsDownload = safeHttps(SITE.windowsDownloadUrl);
activateLinks("[data-repo-link]", repo);
activateLinks("[data-release-link]", releases);
activateLinks("[data-download-link]", directDownload || releases);
activateLinks("[data-windows-download-link]", windowsDownload || releases);
const downloadStatus = document.getElementById("download-status");

if (downloadStatus && (directDownload || releases)) {
  downloadStatus.textContent = directDownload
    ? "macOS · Apple Silicon download"
    : "Opens GitHub Releases. Choose the macOS Apple Silicon build.";
}

// The original PNG is displayed without cropping or regeneration.
// If it is absent, show an intentional text placeholder, never a broken image.
const portrait = document.getElementById("murz-photo");
portrait.addEventListener("load", () => {
  portrait.hidden = false;
  document.getElementById("photo-fallback").hidden = true;
});
portrait.addEventListener("error", () => {
  portrait.hidden = true;
  document.getElementById("photo-fallback").hidden = false;
});
portrait.src = SITE.catImage;

// Murz hover animation

(() => {
  const stage = document.getElementById("cat-stage");
  const video = document.getElementById("murz-hover-video");

  if (!stage || !video) return;

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  if (reducedMotion.matches) return;

  let canPlay = true;
  let interactionId = 0;

  function showStaticMurz() {
    stage.classList.remove("is-hovering");
    video.pause();

    if (video.readyState >= 1) {
      video.currentTime = 0;
    }
  }

  function startAnimation() {
    // Запрещаем повторное воспроизведение,
    // пока мышь не покинет область кота.
    if (!canPlay) return;

    canPlay = false;
    const currentId = ++interactionId;

    video.pause();

    if (video.readyState >= 1) {
      video.currentTime = 0;
    }

    video.play().then(() => {
      if (currentId === interactionId) {
        stage.classList.add("is-hovering");
      }
    }).catch(() => {
      if (currentId === interactionId) {
        showStaticMurz();
      }
    });
  }

  function stopAnimation() {
    ++interactionId;
    canPlay = true;
    showStaticMurz();
  }

  // Наведение мыши
  stage.addEventListener("pointerenter", startAnimation);

  // Уход мыши
  stage.addEventListener("pointerleave", stopAnimation);

  // Видео закончилось — возвращаем статичного Мурза.
  // canPlay остаётся false, пока курсор не уйдёт.
  video.addEventListener("ended", () => {
    showStaticMurz();
  });

})();