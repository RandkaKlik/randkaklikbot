async function getUpdatedPhotoUrl(fileId, bot) {
  try {
    const fileInfo = await bot.getFile(fileId);
    const photoUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
    console.log("Updated photo URL:", photoUrl);
    return photoUrl;
  } catch (error) {
    console.error("Error updating photo URL:", error);
    return null;
  }
}

module.exports = { getUpdatedPhotoUrl };
