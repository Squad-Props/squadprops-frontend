"use client";

import { useState, useEffect } from "react";
import styles from "./page.module.css";
import { fetchCallReadOnlyFunction, cvToJSON, uintCV, principalCV } from "@stacks/transactions";
import { STACKS_MAINNET } from "@stacks/network";
import { CONTRACT_ADDRESS, CONTRACT_NAME, userSession } from "@/config";

type TabType = "all" | "received" | "given";

interface HistoryItem {
  id: number;
  type: "received" | "given";
  from: string;
  to: string;
  amount: number;
  message: string;
  blockHeight: number;
  // We can't easily get the date without block time conversion, so we'll use block height
}

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [userAddress, setUserAddress] = useState<string>('');

  useEffect(() => {
    if (userSession && userSession.isUserSignedIn()) {
      setIsSignedIn(true);
      const userData = userSession.loadUserData();
      const address = userData.profile?.stxAddress?.mainnet || '';
      setUserAddress(address);
    }
  }, []);

  useEffect(() => {
    if (userAddress) {
      loadHistory();
    }
  }, [userAddress, activeTab]);

  // Helper for delayed fetch with retries (reused from Leaderboard)
  const robustFetch = async (fn: () => Promise<any>, retries = 3, delayMs = 500) => {
    for (let i = 0; i < retries; i++) {
      try {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return await fn();
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, i)));
      }
    }
  };

  const loadHistory = async () => {
    setIsLoading(true);
    setHistoryItems([]);

    try {
      const network = { ...STACKS_MAINNET, fetchFn: fetch };
      
      // Strategy:
      // 1. "Received" -> fetch user's history list
      // 2. "Given" / "All" -> scan recent global props (limited to 50)
      
      const items: HistoryItem[] = [];

      if (activeTab === "received") {
        const historyResult = await robustFetch(() => fetchCallReadOnlyFunction({
          contractAddress: CONTRACT_ADDRESS,
          contractName: CONTRACT_NAME,
          functionName: "get-user-history",
          functionArgs: [principalCV(userAddress)],
          network,
          senderAddress: userAddress,
        }));

        const historyJSON = cvToJSON(historyResult);
        const historyIds = historyJSON.value?.value || [];
        
        // Fetch details for each ID (last 20 to avoid overload)
        const recentIds = historyIds.slice(-20).reverse();

        for (const idWrapper of recentIds) {
          try {
            const id = parseInt(idWrapper.value);
            const propsResult = await robustFetch(() => fetchCallReadOnlyFunction({
              contractAddress: CONTRACT_ADDRESS,
              contractName: CONTRACT_NAME,
              functionName: "get-props-by-id",
              functionArgs: [uintCV(id)],
              network,
              senderAddress: userAddress,
            }));

            const propsJSON = cvToJSON(propsResult);
            const propData = propsJSON.value?.value?.value || propsJSON.value?.value;

            if (propData) {
              items.push({
                id,
                type: "received",
                from: propData.giver.value,
                to: propData.receiver.value,
                amount: parseInt(propData.amount.value),
                message: propData.message.value,
                blockHeight: parseInt(propData.timestamp.value), // Using timestamp as block height
              });
            }
          } catch (e) {
            console.error("Error fetching prop details:", e);
          }
        }
      } else {
        // For "Given" or "All", we scan recent global props
        // Get current props ID
        const counterResult = await robustFetch(() => fetchCallReadOnlyFunction({
          contractAddress: CONTRACT_ADDRESS,
          contractName: CONTRACT_NAME,
          functionName: "get-current-props-id",
          functionArgs: [],
          network,
          senderAddress: userAddress,
        }));

        const counterJSON = cvToJSON(counterResult);
        const totalProps = counterJSON.value ? parseInt(counterJSON.value.value) : 0;
        
        // Scan last 50 props
        const limit = Math.min(50, totalProps);
        const startIndex = Math.max(0, totalProps - limit);

        for (let i = totalProps - 1; i >= startIndex; i--) {
          try {
            const propsResult = await robustFetch(() => fetchCallReadOnlyFunction({
              contractAddress: CONTRACT_ADDRESS,
              contractName: CONTRACT_NAME,
              functionName: "get-props-by-id",
              functionArgs: [uintCV(i)],
              network,
              senderAddress: userAddress,
            }));

            const propsJSON = cvToJSON(propsResult);
            const propData = propsJSON.value?.value?.value || propsJSON.value?.value;

            if (propData) {
              const giver = propData.giver.value;
              const receiver = propData.receiver.value;
              
              const isGiver = giver === userAddress;
              const isReceiver = receiver === userAddress;

              if (activeTab === "given" && isGiver) {
                items.push({
                  id: i,
                  type: "given",
                  from: giver,
                  to: receiver,
                  amount: parseInt(propData.amount.value),
                  message: propData.message.value,
                  blockHeight: parseInt(propData.timestamp.value),
                });
              } else if (activeTab === "all" && (isGiver || isReceiver)) {
                items.push({
                  id: i,
                  type: isReceiver ? "received" : "given",
                  from: giver,
                  to: receiver,
                  amount: parseInt(propData.amount.value),
                  message: propData.message.value,
                  blockHeight: parseInt(propData.timestamp.value),
                });
              }
            }
          } catch (e) {
             console.error(`Error scanning prop ${i}:`, e);
          }
        }
      }

      setHistoryItems(items);
    } catch (error) {
      console.error("Error loading history:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isSignedIn) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.header}>
            <h1 className={styles.title}>📜 Props History</h1>
            <p className={styles.subtitle}>Please connect your wallet to view your history</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>📜 Props History</h1>
          <p className={styles.subtitle}>
            View all your props transactions on the blockchain
          </p>
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === "all" ? styles.active : ""}`}
            onClick={() => setActiveTab("all")}
          >
            All Activity
          </button>
          <button
            className={`${styles.tab} ${activeTab === "received" ? styles.active : ""}`}
            onClick={() => setActiveTab("received")}
          >
            Received
          </button>
          <button
            className={`${styles.tab} ${activeTab === "given" ? styles.active : ""}`}
            onClick={() => setActiveTab("given")}
          >
            Given
          </button>
        </div>

        {isLoading ? (
          <div className={styles.emptyState}>
            <p>Loading blockchain history...</p>
          </div>
        ) : historyItems.length > 0 ? (
          <div className={styles.timeline}>
            {historyItems.map((item) => (
              <div key={item.id} className={styles.timelineItem}>
                <div className={styles.itemHeader}>
                  <span className={styles.itemType}>
                    {item.type === "received" ? "📥 Received" : "📤 Given"}
                  </span>
                  <span className={styles.itemDate}>Block #{item.blockHeight}</span>
                </div>

                <div className={styles.itemContent}>
                  <div className={styles.itemAddresses}>
                    <span className={styles.address}>
                      {item.from.slice(0, 10)}...{item.from.slice(-8)}
                    </span>
                    <span className={styles.arrow}>→</span>
                    <span className={styles.address}>
                      {item.to.slice(0, 10)}...{item.to.slice(-8)}
                    </span>
                  </div>

                  <div className={styles.itemMessage}>{item.message}</div>
                </div>

                <div className={styles.itemFooter}>
                  <span className={styles.propsAmount}>
                    {item.amount} prop{item.amount > 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📭</div>
            <p>No {activeTab !== "all" ? activeTab : ""} props history found in recent blocks</p>
          </div>
        )}
      </div>
    </div>
  );
}
