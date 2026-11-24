# Job Autofill Vault

## Install
1. Unzip this folder.
2. Open `chrome://extensions`, turn on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped `job-autofill` folder.
4. Pin the extension, open the popup and fill in your details (they save automatically).

## Use
- **Fill this page**: popup button, or press `Alt+Shift+F` (change at `chrome://extensions/shortcuts`).
- **Right-click any text box -> Job Autofill: insert saved value** for fields autofill missed.
- **Custom answers**: add reusable answers with keywords; any form label containing a keyword gets that answer.
- Already-filled fields are skipped unless "Overwrite filled fields" is ticked.
- **Export / Import JSON** to back up or move your data.

## Limits
- Resume/file uploads can't be automated by extensions; attach manually.
- Yes/No, Male/Female and similar radio or button questions are answered from the "Choice questions" section of the Profile tab. Checkboxes (e.g. "I agree") are never ticked.
- Data is stored unencrypted in this browser only. Don't save passwords or ID/bank numbers.
- Always review the form before submitting.
