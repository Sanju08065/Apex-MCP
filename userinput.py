# userinput.py
import tkinter as tk
from tkinter import scrolledtext

def submit_input():
    user_text = text_box.get("1.0", tk.END).rstrip()
    print("\n----- USER INPUT START -----")
    print(user_text)
    print("----- USER INPUT END -----\n")

# Create main window
root = tk.Tk()
root.title("User Input")
root.geometry("600x400")

# Label
label = tk.Label(root, text="Enter your input below:")
label.pack(pady=5)

# Large text box (supports large / multiline input)
text_box = scrolledtext.ScrolledText(root, wrap=tk.WORD, width=70, height=18)
text_box.pack(padx=10, pady=10)

# Submit button
submit_btn = tk.Button(root, text="Submit", command=submit_input)
submit_btn.pack(pady=5)

# Start GUI loop
root.mainloop()
