router.post("/save-address", async (req, res) => {
  try {
    const {
      name,
      phone,
      addressText,
      streetNumber,
      zone,
      building,
      floor,
      aptNo,
      lat,
      lng,
    } = req.body;

    if (!phone || !phone.trim()) {
      return res.status(400).json({
        success: false,
        message: "Phone is required",
      });
    }

    const customer = await Customer.findOneAndUpdate(
      { phone: phone.trim() },
      {
        $set: {
          name: name?.trim() || "",
          addressText: addressText?.trim() || "",
          streetNumber: streetNumber?.trim() || "",
          zone: zone?.trim() || "",
          building: building?.trim() || "",
          floor: floor?.trim() || "",
          aptNo: aptNo?.trim() || "",
          location: {
            lat: lat ?? null,
            lng: lng ?? null,
          },
        },
      },
      {
        new: true,
        upsert: true, // 🔥 create if not exists
      }
    );

    res.json({
      success: true,
      customer,
    });
  } catch (error) {
    console.error("save-address error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to save address",
    });
  }
});