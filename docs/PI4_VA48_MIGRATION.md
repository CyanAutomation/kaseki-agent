# Raspberry Pi 4: 48-bit virtual-address migration

Use this procedure when the locked workerd binary fails its actual-worker
smoke with TCMalloc's 48-bit address-placement error on a 39-bit Pi kernel.
The October 2026 investigation confirmed this on two Raspberry Pi 4 Model B
systems. Both exposed `CONFIG_ARM64_VA_BITS=39` with 4 KiB pages.

This is a custom-kernel migration, separate from a Kaseki image update. Start
with the spare Pi, preserve its stock boot files and modules, and validate
the candidate before scheduling a service-host maintenance window. A successful build alone is insufficient; verify boot and runtime behavior
on the device as described below.

## Prepare the candidate

The prepared build uses Raspberry Pi's `rpi-6.18.y` source at immutable commit
`a1a601d4857978d810175365550c4536701df4ed`, the spare Pi's existing kernel
configuration, 4 KiB pages, and a distinct `-kaseki-va48` local version.
The resulting release is `6.18.56-kaseki-va48+`. This also advances the
kernel from the spare Pi's original 6.18.29 release; review that version
change when evaluating the candidate.

In a separate Linux ARM64 build environment with GCC, make, bc, bison, flex,
OpenSSL/ELF development headers, rsync, cpio, and kmod:

```bash
git init linux
cd linux
git remote add origin https://github.com/raspberrypi/linux.git
git fetch --depth 1 origin a1a601d4857978d810175365550c4536701df4ed
git checkout --detach FETCH_HEAD
cp /path/to/pi-original.config .config
scripts/config --disable ARM64_VA_BITS_39 --enable ARM64_VA_BITS_48 \
  --set-val ARM64_VA_BITS 48 --set-str LOCALVERSION '-kaseki-va48' \
  --disable LOCALVERSION_AUTO
make ARCH=arm64 olddefconfig
make -s ARCH=arm64 kernelrelease
make -j4 ARCH=arm64 Image modules dtbs
make ARCH=arm64 INSTALL_MOD_STRIP=1 INSTALL_MOD_PATH=/path/to/staging modules_install
```

Build and install the staging tree on a case-sensitive Linux filesystem.
Some module names differ only by case; a macOS bind mount can overwrite
those files. Export the completed tree as a tar archive for transfer.

Check the resolved configuration for `CONFIG_ARM64_VA_BITS_48=y`,
`CONFIG_ARM64_VA_BITS=48`, and `CONFIG_ARM64_4K_PAGES=y`. Save the source
commit, complete config, compiler identity, kernel release, build log, and
bundle checksum. Package the kernel image, its matching modules, the Pi 4
device tree, and compiled overlays together. A Pi 5 `kernel_2712.img` is
not a substitute for the Pi 4 kernel.

See Raspberry Pi's [kernel build guide](https://www.raspberrypi.com/documentation/computers/linux_kernel.html)
for platform build and installation details.

## Stage and test on the spare Pi

1. Confirm console or power-cycle access, and record the current bootloader,
   kernel, networking, root filesystem, and Docker state. Keep the stock
   `config.txt`, kernel image, device tree, initramfs, and modules available.
2. Verify the candidate checksum. Install its modules under the exact new
   kernel release, leaving the running release's module directory intact.
   Stage the image, matching device tree, overlays, and a candidate initramfs
   in a separate boot subdirectory. Generate the initramfs for the candidate
   release after staging its modules; do not reuse the stock initramfs.
3. Prepare a separate `tryboot.txt` using the stock device settings and
   explicit candidate kernel, device-tree, overlay, and initramfs paths.
   Review those paths against the actual bundle and firmware configuration.
   Keep `config.txt` as the normal boot path.
4. After reviewing the staged configuration and rollback access, request a
   one-time boot with `sudo reboot '0 tryboot'`. Raspberry Pi documents
   [tryboot configuration](https://www.raspberrypi.com/documentation/computers/config_txt.html).
   The one-time selection does not itself recover a running kernel whose
   networking is broken; retain physical recovery access.
5. Verify SSH, the exact candidate kernel release, 48-bit configuration,
   4 KiB pages, required devices, root filesystem, and Docker. Run the locked
   binary's actual-worker smoke and the full auth-worker integration suite.
   A version-only workerd check is insufficient.
6. Reboot back into the stock configuration if any gate fails. Promote the
   candidate to the normal boot path only after the spare-host gates pass.

## Service-host rollout

Use the tested bundle and a maintenance window for the service Pi. Drain
active Kaseki work before the one-time boot. Validate the API readiness,
runtime smoke, validation-only canary, and one normal coding canary before
resuming regular runs. Deploy the Kaseki diagnostics fixes and the Matmetrics
release-history lifecycle fix as separate reviewable changes.

Kernel package upgrades may replace stock boot files while the custom
candidate remains separately named. Keep ownership of the selected boot
configuration explicit and re-run the runtime smoke after future kernel or
workerd changes. Preserve the last known working bundle for rollback.

## Verified spare-host result, 15 October 2026

The candidate booted on `192.168.88.200` using one-time tryboot. SSH,
networking, Docker, and the ext4 root filesystem remained available, with
no failed systemd units. The running release was `6.18.56-kaseki-va48+`,
with `CONFIG_ARM64_VA_BITS=48` and a 4,096-byte page size.

The exact workerd binary from the failed runs, version `1.20261006.1`,
had SHA-256 `771ea4ae96265a16ee19ba2c0612190d1e93831ca9e3ebd62607d36be6b3b990`.
Its actual-worker smoke aborted with exit 134 under the stock 39-bit kernel
and passed under the candidate. The locked Matmetrics auth-worker suite
then passed type checking and all 28 tests across three files in a Node 24
Linux ARM64 container. Vitest completed in 46.25 seconds.

The tested kernel/modules/DTB/overlay archive has SHA-256
`4a2c8cb4dc735837c254c7402734cf2b8aa1c1b7b4736c8ec7b5783106aea63e`.
Stage modules on a case-sensitive filesystem; the archive preserves both
`xt_RATEEST.ko.xz` and `xt_rateest.ko.xz`.

The tested `tryboot.txt` was:

```ini
[all]
overlay_prefix=kaseki-va48/overlays/
include config.txt
[all]
auto_initramfs=0
kernel=kaseki-va48/kernel8-kaseki-va48.img
device_tree=kaseki-va48/bcm2711-rpi-4-b.dtb
initramfs kaseki-va48/initramfs8 followkernel
```

The normal `config.txt`, `cmdline.txt`, and stock `kernel8.img` checksums
remained unchanged. A normal reboot still selects the stock configuration;
this test did not permanently promote the candidate. The spare host uses a
RAM-backed `/tmp` cleared on reboot, so retain test checkouts and rollout
bundles under persistent storage such as `/home/pi`.

The service Pi `192.168.88.201` has not been rebooted or migrated by this
spare-host test. Validate its own boot configuration, recovery access, and
active jobs before applying the tested bundle there.
