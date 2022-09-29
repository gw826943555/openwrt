include $(TOPDIR)/rules.mk

PKG_NAME:=ath11k-bdf
PKG_SOURCE_DATE:=2022-09-12
PKG_SOURCE_VERSION:=3e098cdf20f1bf481d753ab9782ba390751ea825
PKG_MIRROR_HASH:=fc39a033c7fc95e6989df9387b8e29eca311dc2079ae061e662395c1db3fef1e
PKG_RELEASE:=$(AUTORELEASE)

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://git.codelinaro.org/clo/qsdk/oss/ath11k-bdf.git

PKG_LICENSE_FILES:=LICENSE

PKG_MAINTAINER:=Johnny Bravo <jb@ravo.com>

include $(INCLUDE_DIR)/package.mk

define Package/ath11k-bdf-default
  SECTION:=firmware
  CATEGORY:=Firmware
  URL:=$(PKG_SOURCE_URL)
  DEPENDS:=
endef

define Package/ath11k-bdf-ipq6018
$(Package/ath11k-bdf-default)
  TITLE:=ath11k board files for IPQ6018 devices
endef

define Build/Compile
endef

define Package/ath11k-bdf-ipq6018/install
	$(INSTALL_DIR) $(1)/lib/firmware/ath11k/IPQ6018/hw1.0
	$(INSTALL_DATA) \
		$(PKG_BUILD_DIR)/IPQ6018/hw1.0/WLAN.HK.2.7.0.1/WLAN.HK.2.7.0.1-01744-QCAHKSWPL_SILICONZ-1/board-2.bin \
		$(1)/lib/firmware/ath11k/IPQ6018/hw1.0
endef

$(eval $(call BuildPackage,ath11k-bdf-ipq6018))
