include $(TOPDIR)/rules.mk

PKG_NAME:=ipq-wifi-bdf
PKG_SOURCE_DATE:=2022-11-12
PKG_SOURCE_VERSION:=671f5d4d2ae8adc905acd63c5a04ccc4bbd3f5c4
PKG_MIRROR_HASH:=375af0f06b281a3022a937636c82754e7d3fa48dfaac9d448b8119e1c3d5ff05
PKG_RELEASE:=$(AUTORELEASE)

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/mrnuke/ipq-wifi-bdf.git

PKG_MAINTAINER:=Johnny Bravo <jb@ravo.com>

include $(INCLUDE_DIR)/package.mk

define Package/ipq-bdf-default
  SECTION:=firmware
  CATEGORY:=Firmware
  URL:=$(PKG_SOURCE_URL)
  DEPENDS:=
endef

define Package/ath11k-vbdf-ipq6018
$(Package/ipq-bdf-default)
  TITLE:=ath11k board files for IPQ6018 devices
endef

define Build/Compile
endef

define Package/ath11k-vbdf-ipq6018/install
	$(INSTALL_DIR) $(1)/lib/firmware/ath11k/IPQ6018/hw1.0
	$(INSTALL_DATA) \
		$(PKG_BUILD_DIR)/IPQ6018/hw1.0/*-board-2.bin \
		$(1)/lib/firmware/ath11k/IPQ6018/hw1.0/
endef

$(eval $(call BuildPackage,ath11k-vbdf-ipq6018))
