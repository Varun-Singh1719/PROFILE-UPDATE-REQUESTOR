import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";
import LogOut from "@mui/icons-material/LogoutOutlined";

export default function LogoutConfirmModal({ open, onCancel, onConfirm }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut sx={{ fontSize: 18 }} className="text-[#ec9324]"/> Logout
          </DialogTitle>
          <DialogDescription>Are you sure you want to logout?</DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onCancel} data-testid="logout-cancel-btn">Cancel</Button>
          <Button
            onClick={onConfirm}
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white"
            data-testid="logout-confirm-btn"
          >
            Logout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
