# GROMACS built from source against CUDA, for the Amsterdam box (2× RTX 5090).
#
# This was `apt-get install gromacs` on ubuntu:22.04 — a CPU-only Debian build. Moving
# that image onto a machine with two Blackwell cards buys nothing, which is why
# docs/NEXT-SESSION.md listed it as needing a source build before the move is worth
# making at all.
#
# Two things here are load-bearing and both are version-sensitive:
#
#   1. RTX 5090 is Blackwell, compute capability 12.0 → sm_120. That is NOT the same
#      target as sm_100 datacenter Blackwell; a build for one will not run on the other.
#   2. GROMACS 2025.x is documented failing on this hardware — 2025.2 hits ptxas
#      "threads per SM ... out of range" against CUDA 12.8, and 2025.3 gives kernel
#      launch failures on sm_120. 2026.3 postdates those reports and its install guide
#      states CUDA 12.1+. Do not lower this pin without re-reading the GROMACS forum.
#
# Compiling for sm_120 does NOT require a Blackwell card — nvcc only needs the toolkit.
# So this image can be built and its arch verified on any x86_64 Docker host before the
# box lands; only *running* it needs the GPU.
#
# ── Where this gets built: ON THE BOX, decided 2026-07-30 ────────────────────
# It could be built anywhere x86_64, but building it on the target machine is strictly
# better and costs nothing extra, because GROMACS is Phase 6 — it is not on the critical
# path to the docking cutover, so a failed compile costs a retry rather than a delay.
#
# That decision is why GMX_SIMD defaults to AUTO below rather than a hardcoded target:
# when the build host IS the run host, CMake's own detection beats any guess written here.
# The box is a Threadripper PRO 9975WX (Zen 5), where AUTO is expected to select AVX2_256 —
# GROMACS still favours 256-bit over AVX-512 on AMD. Override only with a measurement:
#   docker build --build-arg GMX_SIMD=AVX_512 services/gromacs-api
#
# ⚠ Only the tarball version has been verified so far (2026.3 fetches 200 from ftp.gromacs.org,
# checked 2026-07-30). The compile itself has never been run — this Mac is arm64 and the CUDA
# images are x86_64-only. Expect roughly 30–60 minutes on 32 cores the first time.

ARG CUDA_VERSION=12.8.1
ARG GROMACS_VERSION=2026.3
ARG GMX_SIMD=AUTO

# ── build stage ──────────────────────────────────────────────────────────────
FROM nvidia/cuda:${CUDA_VERSION}-devel-ubuntu22.04 AS build
ARG GROMACS_VERSION
ARG GMX_SIMD
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake ninja-build wget ca-certificates \
      libfftw3-dev libhwloc-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN wget -q "https://ftp.gromacs.org/gromacs/gromacs-${GROMACS_VERSION}.tar.gz" \
    && tar xf "gromacs-${GROMACS_VERSION}.tar.gz" \
    && rm "gromacs-${GROMACS_VERSION}.tar.gz"

WORKDIR /src/build
# CMAKE_CUDA_ARCHITECTURES=120 is the entire point of this file. Plain `120` (rather than
# `120-real`) also embeds PTX, so a future card can JIT rather than failing outright.
# GMX_BUILD_OWN_FFTW is off because libfftw3-dev is installed above.
RUN cmake "../gromacs-${GROMACS_VERSION}" \
      -GNinja \
      -DCMAKE_BUILD_TYPE=Release \
      -DGMX_GPU=CUDA \
      -DCMAKE_CUDA_ARCHITECTURES=120 \
      -DCUDAToolkit_ROOT=/usr/local/cuda \
      -DGMX_MPI=OFF \
      -DGMX_OPENMP=ON \
      -DGMX_BUILD_OWN_FFTW=OFF \
      -DGMX_SIMD="${GMX_SIMD}" \
      -DCMAKE_INSTALL_PREFIX=/opt/gromacs \
    && ninja -j"$(nproc)" \
    && ninja install

# Fail here rather than discovering it on the box: if CUDA support did not actually
# compile in, `gmx -version` will not report a CUDA-enabled build.
RUN . /opt/gromacs/bin/GMXRC \
    && gmx -quiet -version 2>&1 | tee /tmp/gmxver \
    && grep -qiE "GPU support:[[:space:]]*CUDA" /tmp/gmxver \
    && echo "OK: CUDA-enabled GROMACS ${GROMACS_VERSION}"

# ── runtime stage ────────────────────────────────────────────────────────────
# Runtime needs the CUDA runtime libraries, not the multi-GB toolkit.
FROM nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu22.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip curl libfftw3-3 libhwloc15 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3 1 \
    && update-alternatives --install /usr/bin/pip pip /usr/bin/pip3 1

COPY --from=build /opt/gromacs /opt/gromacs
ENV PATH=/opt/gromacs/bin:$PATH \
    LD_LIBRARY_PATH=/opt/gromacs/lib:/opt/gromacs/lib64:$LD_LIBRARY_PATH \
    GMX_MAXBACKUP=-1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
# ⚠ This line has referenced `templates/` since before the CUDA rewrite, and the directory
# did not exist in any commit — the four MDP files sat flattened at the top level as
# `templates_em.mdp` … so the image could never build. Restored 2026-07-30 to
# templates/{em,npt,nvt,md}.mdp, which is also what README.md documents and what
# `GET /templates/em.mdp` serves (app.py:35 reads WORK_DIR/.templates).
COPY templates/ /data/.templates/
RUN mkdir -p /data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
